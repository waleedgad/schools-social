import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import { UploadQueue } from "./core/queue";
import { JsonStore } from "./core/store";
import { importFolder, LibrarySync } from "./core/sync";

type Settings = {
  server: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  library: string | null;
  backup: string | null;
  email: string | null;
  userId: string | null;
  schoolId: string | null;
  schoolName: string | null;
  role: string | null;
  openAtLogin: boolean;
  language: "ar" | "en";
};

const data = (name: string) => path.join(app.getPath("userData"), name);
let settings: JsonStore<Settings>;
let queue: UploadQueue;
let supabase: SupabaseClient | null = null;
let sync: LibrarySync | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastMessage = "";

// The sign-in session is encrypted with the operating system's key store.
const sessionFile = () => data("session.bin");
function readSession(): Record<string, string> {
  try {
    const raw = readFileSync(sessionFile());
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8"));
  } catch {
    return {};
  }
}
function writeSession(value: Record<string, string>) {
  const text = JSON.stringify(value);
  writeFileSync(sessionFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text));
}
const authStorage = {
  getItem: (key: string) => readSession()[key] ?? null,
  setItem: (key: string, value: string) => writeSession({ ...readSession(), [key]: value }),
  removeItem: (key: string) => {
    const s = readSession();
    delete s[key];
    writeSession(s);
  },
};

function client() {
  const s = settings.get();
  if (!s.supabaseUrl || !s.supabaseAnonKey) return null;
  supabase ??= createClient(s.supabaseUrl, s.supabaseAnonKey, {
    auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return supabase;
}

function state() {
  const s = settings.get();
  return {
    server: s.server,
    connected: !!s.supabaseUrl,
    signedIn: !!s.userId,
    email: s.email,
    schoolName: s.schoolName,
    role: s.role,
    library: s.library,
    backup: s.backup,
    openAtLogin: s.openAtLogin,
    language: s.language,
    queue: queue.stats(),
    uploading: sync?.current.map((f) => path.basename(f)) ?? [],
    message: lastMessage,
    version: app.getVersion(),
  };
}

function push() {
  win?.webContents.send("state", state());
  const q = queue.stats();
  tray?.setToolTip(`School Social Hub · ${q.pending} waiting · ${q.done} sent`);
}

async function restartSync() {
  await sync?.stop();
  sync = null;
  const s = settings.get();
  const sb = client();
  if (!sb || !s.userId || !s.schoolId || !s.library || !existsSync(s.library)) return push();
  sync = new LibrarySync({
    supabase: sb,
    queue,
    eventsFile: data("events.json"),
    schoolId: s.schoolId,
    userId: s.userId,
    library: s.library,
    backup: s.backup,
    onChange: push,
    log: (m) => {
      lastMessage = m;
    },
  });
  sync.start();
  push();
}

async function connect(server: string) {
  const base = server.trim().replace(/\/+$/, "");
  const url = /^https?:\/\//.test(base) ? base : `https://${base}`;
  const body = await fetch(`${url}/api/desktop-config`, { signal: AbortSignal.timeout(15_000) })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (body?.app !== "school-social-hub") throw new Error("not-hub");
  supabase = null;
  settings.set({ server: url, supabaseUrl: body.supabaseUrl, supabaseAnonKey: body.supabaseAnonKey });
}

async function signIn(email: string, password: string) {
  const sb = client();
  if (!sb) throw new Error("not-connected");
  const { data: auth, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !auth.user) throw new Error("bad-login");
  const { data: m } = await sb
    .from("memberships")
    .select("school_id, role, school:schools(name)")
    .eq("user_id", auth.user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!m) {
    await sb.auth.signOut();
    throw new Error("no-school");
  }
  settings.set({
    email,
    userId: auth.user.id,
    schoolId: m.school_id,
    schoolName: (m.school as unknown as { name: string } | null)?.name ?? "",
    role: m.role,
  });
  await restartSync();
}

async function chooseFolder(title: string) {
  const r = await dialog.showOpenDialog(win!, { title, properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
}

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 720,
    title: "School Social Hub",
    icon: path.join(__dirname, "renderer", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  // Closing the window keeps watching the library from the tray.
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "renderer", "icon.png")).resize({ width: 16, height: 16 }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => win?.show() },
      { label: "Quit", click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on("click", () => win?.show());
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => win?.show());

app.whenReady().then(async () => {
  settings = new JsonStore<Settings>(data("settings.json"), {
    server: "",
    supabaseUrl: "",
    supabaseAnonKey: "",
    library: null,
    backup: null,
    email: null,
    userId: null,
    schoolId: null,
    schoolName: null,
    role: null,
    openAtLogin: true,
    language: "ar",
  });
  queue = new UploadQueue(data("queue.json"));

  const handle = (channel: string, fn: (...args: never[]) => unknown) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        await fn(...(args as never[]));
        return { ok: true, state: state() };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "error", state: state() };
      }
    });

  ipcMain.handle("state", () => state());
  handle("connect", (server: string) => connect(server));
  handle("signIn", (email: string, password: string) => signIn(email, password));
  handle("signOut", async () => {
    await sync?.stop();
    sync = null;
    await client()?.auth.signOut().catch(() => {});
    settings.set({ userId: null, schoolId: null, schoolName: null, role: null });
  });
  handle("chooseLibrary", async () => {
    const dir = await chooseFolder("Photo library folder");
    if (dir) {
      settings.set({ library: dir });
      await restartSync();
    }
  });
  handle("chooseBackup", async () => {
    const dir = await chooseFolder("Backup folder (another drive)");
    if (dir) {
      settings.set({ backup: dir });
      await restartSync();
    }
  });
  handle("clearBackup", async () => {
    settings.set({ backup: null });
    await restartSync();
  });
  handle("importFolder", async (eventName: string, date: string) => {
    const s = settings.get();
    if (!s.library) throw new Error("no-library");
    const source = await chooseFolder("Photos to import");
    if (!source) return;
    const { copied } = await importFolder(s.library, source, eventName, new Date(`${date}T12:00:00`));
    lastMessage = `import:${copied}`;
  });
  handle("retryFailed", () => queue.retryFailed());
  handle("setLanguage", (language: "ar" | "en") => settings.set({ language }));
  handle("setOpenAtLogin", (value: boolean) => {
    settings.set({ openAtLogin: value });
    app.setLoginItemSettings({ openAtLogin: value, openAsHidden: true });
  });
  handle("openWeb", () => shell.openExternal(settings.get().server));

  app.setLoginItemSettings({ openAtLogin: settings.get().openAtLogin, openAsHidden: true });
  createWindow();
  createTray();
  if (process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAsHidden) win?.hide();
  await restartSync();

  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  // Stay in the tray.
});
