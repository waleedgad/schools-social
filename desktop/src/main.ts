import { existsSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { watch, type FSWatcher } from "chokidar";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import { openDb, tx, type Db } from "./core/db";
import { bookHtml, bookPages, type BookSpec } from "./core/books";
import { badPhotos, emptyFolders, exactCopies, folderSize, nearIdentical, oldRejected, otherSizes, removeEmptyFolders } from "./core/cleanup";
import { Engine, importPhotos, listFiles } from "./core/engine";
import { SHOW_FROM, SURE } from "./core/faces";
import { groupMoves, planFiling } from "./core/filing";
import { eventFolder, guessEvent, isLibraryFile, placeFromPath, safeName, setTermDates, type TermDates } from "./core/library";
import type { Ctx } from "./features/ctx";
import { nameMatches } from "./core/names";
import { binTimer, manageApi } from "./features/manage";
import { libraryApi, PHOTO_COLUMNS } from "./features/library";
import { UploadQueue } from "./core/queue";
import { JsonStore } from "./core/store";
import { parseRows, readSheet, type StudentRow } from "./core/students";
import { LibrarySync } from "./core/sync";
import { AuraDownload } from "./core/models";
import { visionFaces } from "./core/vision";
import { downloadPhoto, finishCheck, pushStudents, removeWebCopies, setOptedOut, summary, waitingPhotos } from "./core/web";

type Watched = { path: string; label: string };
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
  // What goes to the website: every new photo, or only picks and post photos.
  sendMode: "picked" | "all";
  faces: boolean;
  paused: boolean;
  watched: Watched[];
  editor: string | null;
  textSize: "normal" | "large";
  theme: "system" | "light" | "dark";
  accent: string;
  quietFrom: string;
  quietTo: string;
  alerts: boolean;
  setupDone: boolean;
  lastBackup: number | null;
  cleanStrict: "gentle" | "normal" | "strict";
  rejectMonths: number;
  selfFiling: boolean;
  // 0.4
  autoName: boolean;
  faceVision: boolean;
  motion: "full" | "less";
  fileAsk: boolean;
  rawFolders: boolean;
  finderTags: boolean;
  lockOriginals: boolean;
  archive: string | null;
  binAuto: boolean;
  cleanReminder: boolean;
  importPhotographer: string;
  importCategory: string;
  importJunk: boolean;
  importSkipDup: boolean;
  splitGap: number;
  importAutoOpen: boolean;
  importEject: boolean;
  importErase: boolean;
  blurNoPost: boolean;
  teamImportAlert: boolean;
  terms: TermDates[];
  todayLayout: unknown;
  wizard: Record<string, boolean>;
  lastCleanReminder: number;
};

const SETTABLE: (keyof Settings)[] = [
  "language", "sendMode", "faces", "paused", "openAtLogin", "textSize", "theme", "accent", "quietFrom", "quietTo", "alerts", "setupDone", "cleanStrict", "rejectMonths", "selfFiling",
  "autoName", "faceVision", "motion", "fileAsk", "rawFolders", "finderTags", "lockOriginals", "binAuto", "cleanReminder", "importPhotographer", "importCategory", "importJunk",
  "importSkipDup", "splitGap", "importAutoOpen", "importEject", "importErase", "blurNoPost", "teamImportAlert", "todayLayout", "wizard", "lastCleanReminder",
];

// The app connects to this address by itself. A school using its own copy
// of the web app can still type another address if this one fails.
const DEFAULT_SERVER = "https://schools-social.vercel.app";

protocol.registerSchemesAsPrivileged([{ scheme: "hub", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const data = (name: string) => path.join(app.getPath("userData"), name);
const models = () => (app.isPackaged ? path.join(process.resourcesPath, "models") : path.join(__dirname, "..", "models"));
let settings: JsonStore<Settings>;
let queue: UploadQueue;
let db: Db;
let engine: Engine | null = null;
let webChecks: JsonStore<{ pending: Record<string, string> }>;
let supabase: SupabaseClient | null = null;
let sync: LibrarySync | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastMessage = "";
let watchers: FSWatcher[] = [];
let pushTimer: NodeJS.Timeout | null = null;
let changed = new Set<string>();
let timers: NodeJS.Timeout[] = [];
let aura: AuraDownload | null = null;
let features: Record<string, (...args: never[]) => unknown> = {};
// Imports running in the background (Import tab and sidebar progress).
let importJobs: () => unknown[] = () => [];

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

const one = <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...(args as never[])) as T | undefined;
const all = <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as never[])) as T[];
const marks = (n: number) => Array(n).fill("?").join(",");

// A small log on this computer, for "Report a problem" and for finding
// out why a picture didn't show. Kept under 2 MB.
function log(m: string) {
  try {
    const file = data("app.log");
    const { appendFileSync, statSync, renameSync } = require("node:fs") as typeof import("node:fs");
    if (existsSync(file) && statSync(file).size > 2_000_000) renameSync(file, data("app.old.log"));
    appendFileSync(file, `${new Date().toISOString()} ${m}\n`);
  } catch {
    // never let logging stop the app
  }
}

// Safe updates: before a new version first opens the library, the library
// database and settings are copied aside. "Go back" in Settings restores
// them. The last five copies are kept.
function backupBeforeUpdate() {
  const version = app.getVersion();
  const mark = data("last-version.txt");
  const last = existsSync(mark) ? readFileSync(mark, "utf8").trim() : null;
  if (last === version || !existsSync(data("library.db"))) {
    writeFileSync(mark, version);
    return;
  }
  const dir = data(path.join("backups", `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-from-${last ?? "old"}`));
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  const probe = new (require("node:sqlite").DatabaseSync)(data("library.db"));
  try {
    probe.exec(`vacuum into '${path.join(dir, "library.db").replace(/'/g, "''")}'`);
  } finally {
    probe.close();
  }
  for (const f of ["settings.json", "queue.json", "events.json", "web-checks.json"]) if (existsSync(data(f))) fs.copyFileSync(data(f), path.join(dir, f));
  writeFileSync(path.join(dir, "version.txt"), last ?? "");
  const all = fs.readdirSync(data("backups")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 5))) fs.rmSync(data(path.join("backups", old)), { recursive: true, force: true });
  writeFileSync(mark, version);
  log(`backed up library before ${version} (was ${last})`);
}

function updateBackups() {
  const fs = require("node:fs") as typeof import("node:fs");
  if (!existsSync(data("backups"))) return [];
  return fs
    .readdirSync(data("backups"))
    .sort()
    .reverse()
    .map((name) => ({ name, version: existsSync(data(path.join("backups", name, "version.txt"))) ? readFileSync(data(path.join("backups", name, "version.txt")), "utf8") : "" }));
}

// Puts a backup back. The app restarts on the restored library.
async function restoreBackup(name: string) {
  const fs = require("node:fs") as typeof import("node:fs");
  const dir = data(path.join("backups", path.basename(name)));
  if (!existsSync(path.join(dir, "library.db"))) throw new Error("no-backup");
  await engine?.stop();
  await sync?.stop();
  db.close();
  for (const f of ["library.db-wal", "library.db-shm"]) fs.rmSync(data(f), { force: true });
  fs.copyFileSync(path.join(dir, "library.db"), data("library.db"));
  for (const f of ["settings.json", "queue.json", "events.json", "web-checks.json"]) if (existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), data(f));
  log(`restored backup ${name}`);
  app.relaunch();
  quitting = true;
  app.exit(0);
}

function disk(dir: string | null) {
  if (!dir || !existsSync(dir)) return null;
  try {
    const s = statfsSync(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

function state() {
  const s = settings.get();
  const counts = one<Record<string, number>>(
    `select
      (select count(*) from photos where missing = 0 and pair_of is null and dup_of is null) photos,
      (select count(*) from photos where missing = 0 and added_at > ?) newPhotos,
      (select count(*) from faces f join photos p on p.id = f.photo_id where f.status = 'suggested' and p.missing = 0) suggested,
      (select count(*) from faces f join photos p on p.id = f.photo_id where f.status = 'unknown' and p.missing = 0) unknown,
      (select count(*) from faces where status in ('confirmed', 'manual')) tagged,
      (select count(*) from students) students,
      (select count(*) from students where portrait is not null) portraits,
      (select count(*) from photos where missing = 0 and dup_of is not null) duplicates,
      (select count(*) from photos where flag = 1 and missing = 0) picks`,
    Date.now() - 7 * 86400_000,
  )!;
  return {
    server: s.server,
    connected: !!s.supabaseUrl,
    signedIn: !!s.userId,
    email: s.email,
    schoolName: s.schoolName,
    role: s.role,
    library: s.library,
    libraryMissing: !!s.library && !existsSync(s.library),
    backup: s.backup,
    lastBackup: s.lastBackup,
    openAtLogin: s.openAtLogin,
    language: s.language,
    sendMode: s.sendMode,
    faces: s.faces,
    paused: s.paused,
    watched: s.watched,
    editor: s.editor,
    textSize: s.textSize,
    theme: s.theme,
    accent: s.accent,
    quietFrom: s.quietFrom,
    quietTo: s.quietTo,
    alerts: s.alerts,
    setupDone: s.setupDone,
    cleanStrict: s.cleanStrict,
    rejectMonths: s.rejectMonths,
    selfFiling: s.selfFiling,
    autoName: s.autoName,
    faceVision: s.faceVision,
    motion: s.motion,
    fileAsk: s.fileAsk,
    rawFolders: s.rawFolders,
    finderTags: s.finderTags,
    lockOriginals: s.lockOriginals,
    archive: s.archive,
    archiveDisk: disk(s.archive),
    binAuto: s.binAuto,
    cleanReminder: s.cleanReminder,
    lastCleanReminder: s.lastCleanReminder,
    importPhotographer: s.importPhotographer,
    importCategory: s.importCategory,
    importJunk: s.importJunk,
    importSkipDup: s.importSkipDup,
    splitGap: s.splitGap,
    importAutoOpen: s.importAutoOpen,
    importEject: s.importEject,
    importErase: s.importErase,
    blurNoPost: s.blurNoPost,
    teamImportAlert: s.teamImportAlert,
    terms: s.terms,
    todayLayout: s.todayLayout,
    wizard: s.wizard,
    imports: importJobs(),
    binCount: one<{ n: number }>("select count(*) n from bin")?.n ?? 0,
    platform: process.platform,
    faceModel: aura?.status ?? null,
    webChecking: Object.keys(webChecks.get().pending).length,
    queue: queue.stats(),
    uploading: sync?.current.map((f) => path.basename(f)) ?? [],
    engine: engine?.status ?? null,
    counts,
    disk: disk(s.library),
    backupDisk: disk(s.backup),
    message: lastMessage,
    version: app.getVersion(),
    folders: all("select * from folders"),
  };
}

// The window gets one update at most every half second, saying what changed.
function push(what = "status") {
  changed.add(what);
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    // The window may be gone while the app is quitting.
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    const list = [...changed];
    changed = new Set();
    win.webContents.send("state", state(), list);
    const q = queue.stats();
    tray?.setToolTip(`School Social Hub · ${engine?.status.processing ?? 0} to read · ${q.pending} to send`);
  }, 500);
}

function remember(action: string, detail: string, undo: unknown, photos?: number[]) {
  db.prepare("insert into history (at, action, detail, undo, who, photos) values (?, ?, ?, ?, ?, ?)").run(
    Date.now(), action, detail, undo ? JSON.stringify(undo) : null, settings.get().email ?? null, photos?.length ? JSON.stringify(photos.slice(0, 2000)) : null,
  );
  db.prepare("delete from history where id < (select max(id) - 500 from history)").run();
}

async function restart() {
  await sync?.stop();
  await engine?.stop();
  watchers.forEach((w) => w.close());
  watchers = [];
  sync = null;
  engine = null;
  const s = settings.get();
  if (s.library && existsSync(s.library)) {
    engine = new Engine({
      db,
      library: s.library,
      cache: data("cache"),
      models: models(),
      faces: () => settings.get().faces,
      paused: () => settings.get().paused,
      aura: () => (aura?.ready() ? aura.file : null),
      vision: process.platform === "darwin" ? (jpeg) => (settings.get().faceVision ? visionFaces(jpeg) : Promise.resolve(null)) : undefined,
      autoName: () => settings.get().autoName,
      onChange: push,
      onPhotoReady: photoReady,
      onNamed: (ids) => syncOptedOut(ids),
      log: (m) => {
        lastMessage = m;
        log(m);
      },
    });
    engine.start().catch((e) => (lastMessage = String(e)));
    for (const w of s.watched) startWatched(w);
  }
  const sb = client();
  if (sb && s.userId && s.schoolId && s.library && existsSync(s.library)) {
    sync = new LibrarySync({
      supabase: sb,
      queue,
      eventsFile: data("events.json"),
      schoolId: s.schoolId,
      userId: s.userId,
      library: s.library,
      backup: null,
      watch: false,
      paused: () => settings.get().paused,
      onChange: () => push("queue"),
      onUploaded: (file, hash, id) => {
        if (!id) return;
        db.prepare("update photos set remote_id = ? where path = ? or hash = ?").run(id, file, hash);
        const p = one<{ id: number }>("select id from photos where path = ?", file);
        if (p) syncOptedOut([p.id]);
      },
      log: (m) => {
        lastMessage = m;
      },
    });
    sync.start();
  }
  push("all");
}

// A photo has been read: back it up, and send it when the school sends everything.
async function photoReady(id: number) {
  const s = settings.get();
  const p = one<{ path: string; hash: string; dup_of: number | null; pair_of: number | null; is_raw: number; remote_id: string | null; flag: number }>(
    "select path, hash, dup_of, pair_of, is_raw, remote_id, flag from photos where id = ?",
    id,
  );
  if (!p) return;
  if (s.selfFiling && s.library && !placeFromPath(s.library, p.path).year) fileSoon(id);
  const fromWeb = webChecks.get().pending[p.path];
  if (fromWeb) queue.markSent(p.hash, fromWeb);
  const known = queue.photoId(p.hash);
  if (known && !p.remote_id) db.prepare("update photos set remote_id = ? where id = ?").run(known, id);
  if (s.backup && s.library && existsSync(s.backup)) {
    const target = path.join(s.backup, path.relative(s.library, p.path));
    await mkdir(path.dirname(target), { recursive: true }).catch(() => {});
    await copyFile(p.path, target, constants.COPYFILE_EXCL)
      .then(() => settings.set({ lastBackup: Date.now() }))
      .catch(() => {});
  }
  if (!p.dup_of && !p.pair_of && !known && (s.sendMode === "all" || p.flag === 1) && !isArchived(p.path)) await sync?.enqueue(p.path);
}

function isArchived(file: string) {
  return all<{ path: string }>("select path from folders where archive = 1").some((f) => file.startsWith(f.path + path.sep));
}

// Photos dropped into a watched folder (a cloud drive, Lightroom exports)
// are copied into the library under "From <folder>".
function startWatched(w: Watched) {
  if (!existsSync(w.path)) return;
  const watcher = watch(w.path, { ignoreInitial: true, depth: 6, awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 } });
  watcher.on("add", async (file) => {
    const s = settings.get();
    if (!s.library || !isLibraryFile(file)) return;
    const r = await importPhotos({ db, library: s.library, files: [file], title: `From ${w.label}`, date: null, className: null, byDay: true, skipDuplicates: true, onProgress: () => {} });
    if (r.copied) {
      lastMessage = `watched:${w.label}`;
      push("photos");
    }
  });
  watchers.push(watcher);
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
  await restart();
}

async function chooseFolder(title: string) {
  const r = await dialog.showOpenDialog(win!, { title, properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
}

// AuraFace arrives in the background; then every face is described again
// with it (names carry over) and matching restarts.
function startAura() {
  aura ??= new AuraDownload(data("models"), () => push("status"));
  if (aura.ready()) return;
  aura
    .start(async (file) => {
      const ort = require("onnxruntime-node") as typeof import("onnxruntime-node");
      const session = await ort.InferenceSession.create(file);
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", new Float32Array(3 * 112 * 112), [1, 3, 112, 112]) });
      const n = (out[session.outputNames[0]].data as Float32Array).length;
      if (n !== 512) throw new Error(`unexpected model (${n})`);
    })
    .then(async () => {
      if (!aura?.ready() || !engine) return;
      log("AuraFace ready: describing faces again");
      await engine.reembedPortraits();
      engine.rescanAll();
      push("faces");
    })
    .catch((e) => log(`AuraFace: ${e}`));
}

// Photos whose original went missing (a folder moved or renamed outside
// the app): look in a folder for the same photos and link them back.
async function findMissing(dir: string) {
  const { fileHash } = await import("./core/photo");
  const lost = all<{ id: number; name: string; hash: string | null; size: number }>("select id, name, hash, size from photos where missing = 1 and path not like ':%' and hash is not null");
  if (!lost.length) return { found: 0, looked: 0 };
  const byName = new Map<string, typeof lost>();
  for (const l of lost) byName.set(l.name.toLowerCase(), [...(byName.get(l.name.toLowerCase()) ?? []), l]);
  const files = await listFiles(dir);
  let found = 0;
  const lib = settings.get().library;
  for (const f of files) {
    const cands = byName.get(path.basename(f).toLowerCase());
    if (!cands) continue;
    const h = await fileHash(f).catch(() => null);
    const hit = cands.find((c) => c.hash === h);
    if (!hit) continue;
    // Inside the library: link in place. Outside: copy it back into the library.
    let target = f;
    if (lib && !path.resolve(f).startsWith(path.resolve(lib) + path.sep)) {
      const old = one<{ path: string }>("select path from photos where id = ?", hit.id)!;
      await mkdir(path.dirname(old.path), { recursive: true });
      target = old.path;
      await copyFile(f, target, constants.COPYFILE_EXCL).catch(() => {});
    }
    db.prepare("update photos set path = ?, missing = 0 where id = ?").run(target, hit.id);
    found++;
  }
  push("photos");
  return { found, looked: files.length };
}

// ---------- Library queries ----------

function photo(id: number) {
  const p = one(`select p.*, ${PHOTO_COLUMNS.replace(/p\.id, /, "")} from photos p where p.id = ?`, id);
  if (!p) return null;
  const faces = all(
    `select f.id, f.x, f.y, f.w, f.h, f.status, f.student_id, f.suggest_id, f.suggest_score,
       s.name_en, s.name_ar, s.class_name, s.can_post, g.name_en as suggest_en, g.name_ar as suggest_ar, g.class_name as suggest_class
     from faces f left join students s on s.id = f.student_id left join students g on g.id = f.suggest_id
     where f.photo_id = ? and f.status != 'rejected' order by f.x`,
    id,
  );
  const edits = all("select id, name, path from photos where edited_of = ? and missing = 0", id);
  const original = p.edited_of ? one("select id, name from photos where id = ?", p.edited_of) : null;
  const raw = all("select id, name, path from photos where pair_of = ?", id);
  return { ...p, faces, edits, original, raw };
}

// ---------- Students and faces ----------

function classes() {
  return all<{ stage: string | null; grade: string | null; class_name: string | null; n: number }>(
    `select stage, grade, class_name, count(*) n from students group by stage, grade, class_name
     order by case stage when 'KG' then 0 when 'Primary' then 1 when 'Prep' then 2 when 'Secondary' then 3 else 4 end,
       case when grade like 'KG%' then 0 else 1 end, cast(replace(replace(grade, 'Grade ', ''), 'KG', '') as integer), class_name`,
  );
}

function students(f: { className?: string; search?: string; year?: string; term?: string; event?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.className) {
    where.push("s.class_name = ?");
    args.push(f.className);
  }
  // Search by spelling too: "Mohamed" finds Muhammad (names.ts).
  const spelled = f.search ? all<{ id: string; name_en: string | null; name_ar: string | null }>("select id, name_en, name_ar from students").filter((s) => nameMatches(f.search!, s.name_en, s.name_ar)).map((s) => s.id).slice(0, 400) : [];
  if (f.search) {
    where.push(`(s.name_en like ? or s.name_ar like ? or s.id like ? or s.class_name like ?${spelled.length ? ` or s.id in (${marks(spelled.length)})` : ""})`);
    args.push(...Array(4).fill(`%${f.search}%`), ...spelled);
  }
  const period: string[] = [];
  const pargs: unknown[] = [];
  if (f.year) {
    period.push("p.year = ?");
    pargs.push(f.year);
  }
  if (f.term) {
    period.push("p.term = ?");
    pargs.push(f.term);
  }
  if (f.event) {
    period.push("p.event_key = ?");
    pargs.push(f.event);
  }
  const inPeriod = period.length ? "and " + period.join(" and ") : "";
  return all(
    `select s.*, (select count(distinct f.photo_id) from faces f join photos p on p.id = f.photo_id
        where f.student_id = s.id and f.status in ('confirmed', 'manual') and p.missing = 0 ${inPeriod}) as photos,
      (select max(coalesce(p.taken_at, p.event_date)) from faces f join photos p on p.id = f.photo_id
        where f.student_id = s.id and f.status in ('confirmed', 'manual') and p.missing = 0) as last_seen,
      (select count(*) from faces f where f.suggest_id = s.id and f.status = 'suggested') as suggested
     from students s ${where.length ? "where " + where.join(" and ") : ""} order by s.class_name, coalesce(s.name_en, s.name_ar) limit 3000`,
    ...pargs,
    ...args,
  );
}

function faceRowsFor(ids: number[]) {
  return all<{ id: number; student_id: string | null; status: string; suggest_id: string | null; suggest_score: number | null; rejected: string; photo_id: number }>(
    `select id, student_id, status, suggest_id, suggest_score, rejected, photo_id from faces where id in (${marks(ids.length)})`,
    ...ids,
  );
}

function restoreFaces(rows: ReturnType<typeof faceRowsFor>, inserted: number[] = []) {
  tx(db, () => {
    const up = db.prepare("update faces set student_id = ?, status = ?, suggest_id = ?, suggest_score = ?, rejected = ? where id = ?");
    for (const r of rows) up.run(r.student_id, r.status, r.suggest_id, r.suggest_score, r.rejected, r.id);
    if (inserted.length) db.prepare(`delete from faces where id in (${marks(inserted.length)})`).run(...inserted);
  });
  syncOptedOut([...new Set(rows.map((r) => r.photo_id))]);
}

// The website blocks a post with a photo of a student who can't appear.
function syncOptedOut(photoIds: number[]) {
  const sb = client();
  if (!sb || !settings.get().userId || !photoIds.length) return;
  const rows = all<{ remote_id: string; opted: number }>(
    `select p.remote_id, exists (select 1 from faces f join students s on s.id = f.student_id
       where f.photo_id = p.id and f.status in ('confirmed', 'manual') and s.can_post = 0) opted
     from photos p where p.id in (${marks(photoIds.length)}) and p.remote_id is not null`,
    ...photoIds,
  );
  if (rows.length) setOptedOut(sb, rows.map((r) => ({ remoteId: r.remote_id, optedOut: !!r.opted }))).catch((e) => (lastMessage = String(e)));
}

function confirmFaces(faceIds: number[], studentId: string) {
  // A person appears once per photo: one face per photo is kept, the best.
  const rows = faceRowsFor(faceIds);
  const perPhoto = new Map<number, number>();
  for (const r of rows.sort((a, b) => (b.suggest_score ?? 0) - (a.suggest_score ?? 0))) if (!perPhoto.has(r.photo_id)) perPhoto.set(r.photo_id, r.id);
  faceIds = [...perPhoto.values()];
  const photoIds = [...perPhoto.keys()];
  const others = photoIds.length
    ? all<{ id: number }>(`select id from faces where photo_id in (${marks(photoIds.length)}) and id not in (${marks(faceIds.length)}) and (student_id = ? or suggest_id = ?) and status in ('confirmed', 'suggested') and (auto = 1 or status = 'suggested')`, ...photoIds, ...faceIds, studentId, studentId).map((r) => r.id)
    : [];
  const before = faceRowsFor([...faceIds, ...others]);
  const who = settings.get().email ?? "me";
  db.prepare(`update faces set student_id = ?, status = 'confirmed', suggest_id = null, suggest_score = null, auto = 0, named_by = ? where id in (${marks(faceIds.length)})`).run(studentId, who, ...faceIds);
  if (others.length) db.prepare(`update faces set status = 'unknown', student_id = null, suggest_id = null, suggest_score = null, auto = 0 where id in (${marks(others.length)})`).run(...others);
  remember("tag", `${faceIds.length}:${studentId}`, { kind: "faces", rows: before });
  syncOptedOut([...new Set(before.map((r) => r.photo_id))]);
  engine?.rematchSoon();
  push("faces");
}

function rejectFaces(faceIds: number[]) {
  const before = faceRowsFor(faceIds);
  tx(db, () => {
    for (const r of before) {
      const rejected = [...new Set([...(r.rejected ? r.rejected.split(",") : []), r.suggest_id, r.student_id].filter(Boolean))].join(",");
      db.prepare("update faces set status = 'unknown', student_id = null, suggest_id = null, suggest_score = null, rejected = ? where id = ?").run(rejected, r.id);
    }
  });
  remember("untag", `${faceIds.length}`, { kind: "faces", rows: before });
  syncOptedOut([...new Set(before.map((r) => r.photo_id))]);
  push("faces");
}

// "Not a face" (a poster, a statue): hide it for good.
function hideFaces(faceIds: number[]) {
  const before = faceRowsFor(faceIds);
  db.prepare(`update faces set status = 'rejected', student_id = null where id in (${marks(faceIds.length)})`).run(...faceIds);
  remember("hide", `${faceIds.length}`, { kind: "faces", rows: before });
  push("faces");
}

// Tag a student in photos where no face was found (from behind, in costume).
function tagPhotos(photoIds: number[], studentId: string) {
  const inserted: number[] = [];
  tx(db, () => {
    for (const id of photoIds) {
      if (one("select 1 from faces where photo_id = ? and student_id = ? and status in ('confirmed', 'manual')", id, studentId)) continue;
      inserted.push(Number(db.prepare("insert into faces (photo_id, x, y, w, h, student_id, status) values (?, 0, 0, 0, 0, ?, 'manual')").run(id, studentId).lastInsertRowid));
    }
  });
  remember("tag", `${photoIds.length}:${studentId}`, { kind: "faces", rows: [], inserted });
  syncOptedOut(photoIds);
  push("faces");
}

function setPhotos(ids: number[], field: "rating" | "flag" | "label", value: number | string | null) {
  const before = all<{ id: number; rating: number; flag: number; label: string | null }>(`select id, rating, flag, label from photos where id in (${marks(ids.length)})`, ...ids);
  db.prepare(`update photos set ${field} = ? where id in (${marks(ids.length)})`).run(value as never, ...ids);
  remember(field, `${ids.length}:${value}`, { kind: "photos", rows: before });
  if (field === "flag" && value === 1 && settings.get().sendMode === "picked") {
    for (const p of all<{ path: string; remote_id: string | null }>(`select path, remote_id from photos where id in (${marks(ids.length)})`, ...ids)) {
      if (!p.remote_id && !isArchived(p.path)) sync?.enqueue(p.path);
    }
  }
  // A pick cleared (or rejected) before it was sent: it no longer goes.
  if (field === "flag" && value !== 1 && settings.get().sendMode === "picked") {
    const files = all<{ path: string }>(`select path from photos where id in (${marks(ids.length)}) and remote_id is null and posts = 0`, ...ids).map((p) => p.path);
    if (files.length && queue.cancel(files)) push("queue");
  }
  push("photos");
}

async function undo() {
  const h = one<{ id: number; action: string; undo: string | null }>("select id, action, undo from history where undo is not null order by id desc limit 1");
  if (!h) return null;
  const u = JSON.parse(h.undo!);
  if (u.kind === "photos") {
    const up = db.prepare("update photos set rating = ?, flag = ?, label = ? where id = ?");
    tx(db, () => u.rows.forEach((r: { id: number; rating: number; flag: number; label: string | null }) => up.run(r.rating, r.flag, r.label, r.id)));
  } else if (u.kind === "faces") restoreFaces(u.rows, u.inserted);
  else if (u.kind === "move") await engine?.moveBack(u.items);
  else if (u.kind === "canPost") db.prepare("update students set can_post = ? where id = ?").run(u.value, u.id);
  else if (u.kind === "bin") await (features.restoreBin as (ids: number[]) => Promise<number>)(u.ids);
  else if (u.kind === "student") db.prepare(`update students set ${u.field} = ? where id = ?`).run(u.value, u.id);
  else if (u.kind === "sql") for (const [sql, args] of u.steps as [string, unknown[]][]) db.prepare(sql).run(...(args as never[]));
  db.prepare("update history set undo = null where id = ?").run(h.id);
  push("all");
  return h.action;
}

// ---------- Class list import ----------

let pendingList: { file: string; students: StudentRow[] } | null = null;

async function previewStudents(file?: string) {
  if (!file) {
    const r = await dialog.showOpenDialog(win!, { title: "Class list", properties: ["openFile"], filters: [{ name: "Excel or CSV", extensions: ["xlsx", "csv"] }] });
    if (r.canceled) return null;
    file = r.filePaths[0];
  }
  const parsed = parseRows(await readSheet(file));
  pendingList = { file, students: parsed.students };
  const existing = new Set(all<{ id: string }>("select id from students").map((s) => s.id));
  const byClass = new Map<string, number>();
  for (const s of parsed.students) byClass.set(s.class_name ?? "—", (byClass.get(s.class_name ?? "—") ?? 0) + 1);
  return {
    file: path.basename(file),
    format: parsed.format,
    count: parsed.students.length,
    skipped: parsed.skipped,
    isNew: parsed.students.filter((s) => !existing.has(s.id)).length,
    classes: [...byClass.entries()].map(([name, n]) => ({ name, n })),
    sample: parsed.students.slice(0, 8),
    columns: parsed.columns,
    portraits: parsed.students.filter((s) => s.portrait).length,
  };
}

async function commitStudents(portraitFolder: string | null) {
  if (!pendingList) throw new Error("no-list");
  const list = pendingList.students;
  const up = db.prepare(
    `insert into students (id, name_en, name_ar, gender, stage, grade, class_name, can_post, added_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (id) do update set name_en = excluded.name_en, name_ar = excluded.name_ar, gender = excluded.gender, stage = excluded.stage,
       grade = excluded.grade, class_name = excluded.class_name, can_post = excluded.can_post`,
  );
  tx(db, () => list.forEach((s) => up.run(s.id, s.name_en, s.name_ar, s.gender, s.stage, s.grade, s.class_name, s.can_post ? 1 : 0, Date.now())));
  pendingList = null;
  push("students");
  let web: number | string = 0;
  const sb = client();
  const s = settings.get();
  if (sb && s.schoolId) web = await pushStudents(sb, s.schoolId, list).catch((e) => `error:${e instanceof Error ? e.message : e}`);
  let portraits = 0;
  if (portraitFolder && engine) {
    lastMessage = "portraits";
    push();
    portraits = await engine.addPortraits(portraitFolder, list);
  }
  push("students");
  return { saved: list.length, web, portraits };
}

// ---------- Coverage ----------

// Coverage by Stage → Grade → Class, in the school's natural order.
// Students who can't appear in posts are counted on their own.
function coverage(f: { year?: string; term?: string; event?: string }) {
  const rows = students(f) as { id: string; class_name: string | null; stage: string | null; grade: string | null; photos: number; can_post: number; last_seen: string | null }[];
  const order = classes().map((c) => c.class_name ?? "—");
  const stale = new Date(Date.now() - 21 * 86400_000).toISOString();
  const byClass = new Map<string, { className: string; stage: string | null; grade: string | null; students: number; zero: number; low: number; good: number; nopost: number; stale: number; photos: number }>();
  for (const r of rows) {
    const k = r.class_name ?? "—";
    const c = byClass.get(k) ?? { className: k, stage: r.stage, grade: r.grade, students: 0, zero: 0, low: 0, good: 0, nopost: 0, stale: 0, photos: 0 };
    byClass.set(k, c);
    if (!r.can_post) {
      c.nopost++;
      continue;
    }
    c.students++;
    c.photos += r.photos;
    if (r.photos === 0) c.zero++;
    else if (r.photos < 3) c.low++;
    else c.good++;
    if (r.last_seen && r.last_seen < stale) c.stale++;
  }
  return [...byClass.values()].sort((a, b) => order.indexOf(a.className) - order.indexOf(b.className));
}

// ---------- People (faces like Apple Photos) ----------

// Each student's main face: the one chosen, else the biggest clear face
// someone confirmed (never an auto-named one).
const MAIN_FACE = `coalesce(s.main_face, (select f.id from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and f.status in ('confirmed', 'manual', 'portrait') and p.missing = 0 order by f.auto, f.status = 'portrait' desc, f.w * f.score desc limit 1))`;

function people(f: { className?: string }) {
  return all(
    `select s.id, s.name_en, s.name_ar, s.class_name, s.stage, s.grade, s.can_post, s.portrait, ${MAIN_FACE} as face,
       (select count(distinct f.photo_id) from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and f.status in ('confirmed', 'manual') and p.missing = 0) as photos,
       (select count(*) from faces f join photos p on p.id = f.photo_id where f.suggest_id = s.id and f.status = 'suggested' and f.suggest_score >= ? and p.missing = 0) as review,
       (select count(*) from faces f where f.student_id = s.id and f.auto = 1 and f.status = 'confirmed') as auto
     from students s ${f.className ? "where s.class_name = ?" : ""} order by photos desc, coalesce(s.name_en, s.name_ar) limit 3000`,
    SHOW_FROM,
    ...(f.className ? [f.className] : []),
  );
}

function person(id: string) {
  const s = one(`select s.*, ${MAIN_FACE} as face from students s where s.id = ?`, id);
  if (!s) return null;
  const photoIds = all<{ id: number }>(
    "select distinct p.id from faces f join photos p on p.id = f.photo_id where f.student_id = ? and f.status in ('confirmed', 'manual') and p.missing = 0 order by p.taken_at desc limit 2000",
    id,
  ).map((r) => r.id);
  const review = all<{ id: number; photo_id: number; suggest_score: number }>(
    "select f.id, f.photo_id, f.suggest_score from faces f join photos p on p.id = f.photo_id where f.suggest_id = ? and f.status = 'suggested' and f.suggest_score >= ? and p.missing = 0 order by f.suggest_score desc limit 240",
    id,
    SHOW_FROM,
  ).map((f) => ({ ...f, sure: f.suggest_score >= SURE - 0.04 }));
  const auto = all("select f.id, f.photo_id, f.suggest_score from faces f join photos p on p.id = f.photo_id where f.student_id = ? and f.auto = 1 and f.status = 'confirmed' and p.missing = 0 order by f.suggest_score limit 120", id);
  const examples = all("select f.id from faces f where f.student_id = ? and f.status in ('confirmed', 'manual', 'portrait') and f.auto = 0 order by f.w * f.score desc limit 24", id);
  const events = all(
    `select p.event_key, p.event_title, p.event_date, count(distinct p.id) n from faces f join photos p on p.id = f.photo_id
     where f.student_id = ? and f.status in ('confirmed', 'manual') and p.missing = 0 group by p.event_key order by p.event_date desc limit 40`,
    id,
  );
  return { student: s, photoIds, review, auto, examples, events };
}

// "Is this Youssef?": one face at a time, the strongest first.
function isThisQueue(studentIds?: string[]) {
  const only = studentIds?.length ? `and f.suggest_id in (${marks(studentIds.length)})` : "";
  return all(
    `select f.id, f.photo_id, f.suggest_score, s.id as student_id, s.name_en, s.name_ar, s.class_name, ${MAIN_FACE} as main
     from faces f join photos p on p.id = f.photo_id join students s on s.id = f.suggest_id
     where f.status = 'suggested' and f.suggest_score >= ? and p.missing = 0 ${only} order by f.suggest_score desc limit 400`,
    SHOW_FROM,
    ...(studentIds ?? []),
  );
}

// ---------- Website uploads and deletes ----------

// Photos uploaded on the website come down into the library, get the same
// face check as the school's own photos, and only then can go into posts.
let checking = false;
async function checkWebUploads() {
  const sb = client();
  const s = settings.get();
  if (checking || !sb || !s.userId || !s.schoolId || !s.library || !existsSync(s.library) || s.paused) return;
  if (!["admin", "comms_lead", "comms"].includes(s.role ?? "")) return;
  checking = true;
  try {
    const pending = { ...webChecks.get().pending };
    const waiting = Object.values(pending);
    for (const w of await waitingPhotos(sb, s.schoolId, 10)) {
      if (waiting.includes(w.id)) continue;
      const bytes = await downloadPhoto(sb, w.storage_path);
      const date = new Date(w.event?.event_date ?? w.taken_at ?? w.created_at);
      const folder = eventFolder(s.library, date, w.event?.title ?? "Website uploads");
      await mkdir(folder, { recursive: true });
      const base = safeName(path.basename(w.original_name ?? w.id, path.extname(w.original_name ?? ""))) || w.id;
      for (let n = 1; n < 1000; n++) {
        const file = path.join(folder, n === 1 ? `${base}.jpg` : `${base} (${n}).jpg`);
        const ok = await writeFile(file, bytes, { flag: "wx" }).then(() => true, (e) => (e.code === "EEXIST" ? false : Promise.reject(e)));
        if (ok) {
          pending[file] = w.id;
          break;
        }
      }
    }
    // Finish the ones the Mac has read and scanned for faces.
    for (const [file, remoteId] of Object.entries(pending)) {
      const p = one<{ id: number; hash: string | null; faces_scanned: number; missing: number }>("select id, hash, faces_scanned, missing from photos where path = ?", file);
      if (!p) {
        if (!existsSync(file)) delete pending[file];
        continue;
      }
      if (!p.hash || (s.faces && p.faces_scanned === 0)) continue;
      // Suggested matches count too: a likely match with a student who can't
      // appear blocks the photo until someone looks.
      const opted = one<{ n: number }>(
        "select count(*) n from faces f join students st on st.id = coalesce(f.student_id, f.suggest_id) where f.photo_id = ? and f.status in ('confirmed', 'manual', 'suggested') and st.can_post = 0",
        p.id,
      );
      await finishCheck(sb, remoteId, (opted?.n ?? 0) > 0);
      db.prepare("update photos set remote_id = ? where id = ?").run(remoteId, p.id);
      queue.markSent(p.hash, remoteId);
      delete pending[file];
    }
    webChecks.set({ pending });
    push("photos");
  } catch (e) {
    lastMessage = `web check: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    checking = false;
  }
}

// Deleting on the Mac removes the web copy too (kept when it was posted).
function removeWebCopiesOf(rows: { id: number; hash: string | null; remote_id: string | null }[]) {
  const sb = client();
  const sent = rows.filter((r) => r.remote_id);
  if (!sb || !sent.length) return;
  removeWebCopies(sb, sent.map((r) => r.remote_id!))
    .then((gone) => {
      for (const r of sent.filter((x) => gone.includes(x.remote_id!))) {
        db.prepare("update photos set remote_id = null where id = ?").run(r.id);
        if (r.hash) queue.unmark(r.hash);
      }
    })
    .catch((e) => (lastMessage = String(e)));
}

// ---------- Self-filing ----------

async function applyFiling(onlyIds?: number[]) {
  const lib = settings.get().library;
  if (!engine || !lib) return { moved: 0, unsure: 0 };
  const { moves, unsure } = planFiling(db, lib, onlyIds);
  const undo: { id: number; from: string }[] = [];
  for (const g of groupMoves(moves)) undo.push(...(await engine.moveTo(g.ids, g)));
  if (undo.length) remember("move", `${undo.length}:filed`, { kind: "move", items: undo });
  push("photos");
  return { moved: undo.length, unsure: unsure.length };
}

// New photos that land outside the filed folders are filed after a short wait.
let toFile = new Set<number>();
let fileTimer: NodeJS.Timeout | null = null;
function fileSoon(id: number) {
  toFile.add(id);
  if (fileTimer) return;
  fileTimer = setTimeout(() => {
    fileTimer = null;
    const ids = [...toFile];
    toFile = new Set();
    applyFiling(ids).catch((e) => (lastMessage = String(e)));
  }, 20_000);
}

// ---------- Albums ----------

// A smart album is a set of rules; every rule must match.
// ---------- Yearbooks and graduation books ----------

// Lays the book out in a hidden window and prints it to an A4 PDF.
async function printBook(spec: BookSpec, file: string) {
  const pages = bookPages(db, spec);
  if (!pages.length) throw new Error("empty-book");
  const html = bookHtml(spec, pages);
  const tmp = data(`book-${Date.now()}.html`);
  writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { offscreen: true } });
  try {
    await w.loadFile(tmp);
    // Wait for every photo (previews are made on demand).
    await w.webContents.executeJavaScript("Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))");
    const pdf = await w.webContents.printToPDF({ pageSize: "A4", printBackground: true, margins: { marginType: "none" } });
    writeFileSync(file, pdf);
    return { file, pages: pages.length };
  } finally {
    w.destroy();
    await rm(tmp, { force: true });
  }
}

function bookSpec(o: Partial<BookSpec>): BookSpec {
  const s = settings.get();
  return { kind: o.kind ?? "yearbook", year: o.year ?? "", grade: o.grade ?? null, className: o.className ?? null, studentId: o.studentId ?? null, school: s.schoolName ?? "", language: o.language ?? s.language };
}

// ---------- Clean up ----------

// The Bin is the Mac's Trash: nothing is deleted outright, and the web copy
// goes too (see removeWebCopiesOf).
function binPhotos(ids: number[]) {
  return (features.bin as (ids: number[]) => Promise<number>)(ids);
}


async function cleanupReport() {
  const s = settings.get();
  const pack = (groups: { extra: number[]; size: number }[]) => ({ count: groups.reduce((n, g) => n + g.extra.length, 0), size: groups.reduce((n, g) => n + g.size, 0) });
  const bad = badPhotos(db, s.cleanStrict);
  const rejected = oldRejected(db, s.rejectMonths);
  const empty = s.library && existsSync(s.library) ? await emptyFolders(s.library) : [];
  return {
    exact: pack(exactCopies(db)),
    sizes: pack(otherSizes(db)),
    bursts: pack(nearIdentical(db)),
    bad: { count: bad.length, size: bad.reduce((n, p) => n + p.size, 0) },
    rejected: { count: rejected.length, size: rejected.reduce((n, p) => n + p.size, 0), months: s.rejectMonths },
    empty: empty.length,
    cache: await folderSize(path.join(data("cache"), "previews")),
    strict: s.cleanStrict,
  };
}

function cleanupList(kind: string) {
  const s = settings.get();
  if (kind === "exact") return { groups: exactCopies(db) };
  if (kind === "sizes") return { groups: otherSizes(db) };
  if (kind === "bursts") return { groups: nearIdentical(db).slice(0, 300) };
  if (kind === "bad") return { photos: badPhotos(db, s.cleanStrict).slice(0, 600) };
  if (kind === "rejected") return { photos: oldRejected(db, s.rejectMonths).slice(0, 600) };
  return {};
}

// ---------- Posts ----------

let postCancelled = false;
async function newPost(ids: number[]) {
  const sb = client();
  const s = settings.get();
  if (!sb || !s.userId || !s.schoolId || !sync) throw new Error("not-signed-in");
  const rows = all<{ id: number; path: string; remote_id: string | null; taken_at: string | null }>(
    `select id, path, remote_id, taken_at from photos where id in (${marks(ids.length)}) order by taken_at`,
    ...ids,
  ).slice(0, 80);
  // The post's photos go first, straight away, even while sending is paused.
  postCancelled = false;
  let done = rows.filter((r) => r.remote_id).length;
  const report = () => {
    lastMessage = `sending:${done}/${rows.length}`;
    push();
  };
  report();
  const waiting = rows.filter((r) => !r.remote_id);
  for (let i = 0; i < waiting.length; i += 3) {
    if (postCancelled) throw new Error("cancelled");
    await Promise.all(waiting.slice(i, i + 3).map((r) => sync!.sendNow(r.path).then(() => (done++, report()))));
  }
  const sent = all<{ remote_id: string | null }>(`select remote_id from photos where id in (${marks(rows.length)})`, ...rows.map((r) => r.id));
  if (!sent.every((x) => x.remote_id)) {
    lastMessage = "";
    throw new Error("upload-failed");
  }
  const fresh = all<{ id: number; path: string; remote_id: string; taken_at: string | null }>(
    `select id, path, remote_id, taken_at from photos where id in (${marks(rows.length)}) order by taken_at`,
    ...rows.map((r) => r.id),
  );
  const eventId = await sync.eventFor(fresh[0].path, fresh[0].taken_at ? new Date(fresh[0].taken_at) : null).catch(() => null);
  const made = await appApi("create", { event: eventId, photos: fresh.map((r) => r.remote_id) });
  const postId = String(made.id ?? "");
  if (!postId) throw new Error(String(made.error ?? "post"));
  lastMessage = "";
  db.prepare(`update photos set posts = posts + 1 where id in (${marks(rows.length)})`).run(...rows.map((r) => r.id));
  remember("post", postId, null, rows.map((r) => r.id));
  push("photos");
  return postId;
}

// The website's posting rules, called with this person's own sign-in, so
// the Mac's Posts and Calendar follow the same approvals and checks.
async function appApi(action: string, payload: Record<string, unknown> = {}) {
  const sb = client();
  const s = settings.get();
  if (!sb || !s.userId) throw new Error("not-signed-in");
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("not-signed-in");
  const res = await net.fetch(`${s.server || DEFAULT_SERVER}/api/app`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...payload, action, locale: s.language, school: s.schoolId }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error("not-signed-in");
  if (!res.ok) throw new Error(String(body.message ?? body.error ?? `server ${res.status}`));
  return body;
}

// ---------- Search (⌘K) ----------

function search(q: string) {
  const like = `%${q}%`;
  return {
    students: (() => {
      const direct = all<{ id: string }>("select id, name_en, name_ar, class_name, kind from students where name_en like ? or name_ar like ? or id like ? order by name_en limit 8", like, like, like);
      if (direct.length >= 8) return direct;
      const more = all<{ id: string; name_en: string | null; name_ar: string | null }>("select id, name_en, name_ar, class_name, kind from students").filter((s) => !direct.some((d) => d.id === s.id) && nameMatches(q, s.name_en, s.name_ar));
      return [...direct, ...more].slice(0, 8);
    })(),
    events: all(
      "select event_key, event_title, max(event_date) event_date, count(*) n from photos where missing = 0 and event_title like ? group by event_key order by event_date desc limit 8",
      like,
    ),
    classes: all("select class_name, count(*) n from students where class_name like ? group by class_name limit 6", like),
  };
}

// ---------- Window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: "School Social Hub",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 18, y: 20 },
    // See-through sidebar: the Mac's own sidebar material, Mica on Windows 11.
    ...(process.platform === "darwin"
      ? { vibrancy: "sidebar" as const, visualEffectState: "followWindow" as const, backgroundColor: "#00000000" }
      : process.platform === "win32"
        ? { backgroundMaterial: "mica" as const, titleBarOverlay: { color: "#00000000", symbolColor: "#6b7180", height: 40 } }
        : { backgroundColor: "#f5f6f8" }),
    icon: path.join(__dirname, "renderer", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, webviewTag: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-attach-webview", (_e, prefs, params) => {
    // The website shown inside the app gets no access to the Mac.
    delete (prefs as Record<string, unknown>).preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    if (!params.src.startsWith(settings.get().server)) _e.preventDefault();
  });
  // Closing the window keeps the library up to date from the menu bar.
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

// Right-click menus are the system's own: the window sends the items, the
// chosen item's id comes back (null when the menu was closed).
type MenuSpec = { id?: string; type?: "separator"; label?: string; key?: string | null; enabled?: boolean; checked?: boolean; sub?: MenuSpec[] };
function popupMenu(items: MenuSpec[]) {
  return new Promise<string | null>((resolve) => {
    let picked: string | null = null;
    const build = (list: MenuSpec[]): Electron.MenuItemConstructorOptions[] =>
      list.map((it) =>
        it.type === "separator"
          ? { type: "separator" }
          : {
              label: it.label ?? "",
              enabled: it.enabled !== false,
              ...(it.checked !== undefined && it.checked !== null ? { type: "checkbox" as const, checked: !!it.checked } : {}),
              ...(it.key ? { accelerator: it.key, registerAccelerator: false } : {}),
              ...(it.sub ? { submenu: build(it.sub) } : {}),
              click: () => {
                picked = it.id ?? null;
                resolve(picked);
              },
            },
      );
    if (!win || win.isDestroyed()) return resolve(null);
    Menu.buildFromTemplate(build(items)).popup({ window: win, callback: () => setTimeout(() => resolve(picked), 80) });
  });
}

function send(command: string) {
  win?.show();
  sendWin("command", command);
}

function sendWin(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args);
}

function createMenu() {
  const en = settings.get().language === "en";
  const L = (a: string, b: string) => (en ? a : b);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "School Social Hub",
        submenu: [
          { role: "about", label: L("About School Social Hub", "عن School Social Hub") },
          { type: "separator" },
          { label: L("Settings…", "الإعدادات…"), accelerator: "Cmd+,", click: () => send("go:settings") },
          { type: "separator" },
          { role: "hide", label: L("Hide", "إخفاء") },
          { role: "hideOthers" },
          { type: "separator" },
          { label: L("Quit", "إنهاء"), accelerator: "Cmd+Q", click: () => { quitting = true; app.quit(); } },
        ],
      },
      {
        label: L("File", "ملف"),
        submenu: [
          { label: L("Import photos…", "استيراد صور…"), accelerator: "Cmd+I", click: () => send("go:import") },
          { label: L("Import class list…", "استيراد قائمة الفصول…"), click: () => send("go:students-import") },
          { label: L("New post from selection", "منشور جديد من المحدد"), accelerator: "Cmd+N", click: () => send("post") },
        ],
      },
      {
        label: L("Edit", "تحرير"),
        submenu: [
          { label: L("Undo", "تراجع"), accelerator: "Cmd+Z", click: () => send("undo") },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { label: L("Select all", "تحديد الكل"), accelerator: "Cmd+A", click: () => send("selectAll") },
          { label: L("Search…", "بحث…"), accelerator: "Cmd+K", click: () => send("search") },
        ],
      },
      {
        label: L("View", "عرض"),
        submenu: [
          { label: L("Today", "اليوم"), accelerator: "Cmd+1", click: () => send("go:today") },
          { label: L("Library", "المكتبة"), accelerator: "Cmd+2", click: () => send("go:library") },
          { label: L("Faces", "الوجوه"), accelerator: "Cmd+3", click: () => send("go:faces") },
          { label: L("Students", "الطلاب"), accelerator: "Cmd+4", click: () => send("go:students") },
          { label: L("Posts", "المنشورات"), accelerator: "Cmd+5", click: () => send("go:posts") },
          { type: "separator" },
          { role: "togglefullscreen" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "resetZoom" },
          ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
        ],
      },
      { role: "windowMenu" },
      { label: L("Help", "مساعدة"), submenu: [{ label: L("School Social Hub help", "مساعدة School Social Hub"), click: () => send("go:help") }] },
    ]),
  );
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "renderer", "icon.png")).resize({ width: 16, height: 16 }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => win?.show() },
      { label: "Pause / resume", click: () => { settings.set({ paused: !settings.get().paused }); push(); } },
      { label: "Quit", click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on("click", () => win?.show());
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => win?.show());
app.on("activate", () => win?.show());

app.whenReady().then(async () => {
  settings = new JsonStore<Settings>(data("settings.json"), {
    server: DEFAULT_SERVER,
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
    sendMode: "picked",
    faces: true,
    paused: false,
    watched: [],
    editor: null,
    textSize: "normal",
    theme: "system",
    accent: "#2f6fdf",
    quietFrom: "21:00",
    quietTo: "07:00",
    alerts: true,
    setupDone: false,
    lastBackup: null,
    cleanStrict: "normal",
    rejectMonths: 6,
    selfFiling: false,
    autoName: true,
    faceVision: true,
    motion: "full",
    fileAsk: false,
    rawFolders: true,
    finderTags: false,
    lockOriginals: false,
    archive: null,
    binAuto: true,
    cleanReminder: true,
    importPhotographer: "",
    importCategory: "",
    importJunk: true,
    importSkipDup: true,
    splitGap: 2,
    importAutoOpen: true,
    importEject: true,
    importErase: false,
    blurNoPost: true,
    teamImportAlert: true,
    terms: [],
    todayLayout: null,
    wizard: {},
    lastCleanReminder: 0,
  });
  setTermDates(settings.get().terms);
  try {
    backupBeforeUpdate();
  } catch (e) {
    log(`backup before update failed: ${e instanceof Error ? e.message : e}`);
  }
  queue = new UploadQueue(data("queue.json"));
  webChecks = new JsonStore(data("web-checks.json"), { pending: {} as Record<string, string> });
  db = openDb(data("library.db"));

  // hub://thumb/12, hub://preview/12, hub://face/40, hub://portrait/S24001
  protocol.handle("hub", async (req) => {
    const url = new URL(req.url);
    const id = decodeURIComponent(url.pathname.slice(1));
    try {
      let file: string | null = null;
      if (url.host === "thumb") file = await engine!.thumb(Number(id));
      else if (url.host === "preview") file = await engine!.preview(Number(id));
      else if (url.host === "face") file = await engine!.faceCrop(Number(id));
      else if (url.host === "portrait") file = one<{ portrait: string }>("select portrait from students where id = ?", id)?.portrait ?? null;
      if (!file) return new Response("", { status: 404 });
      const res = await net.fetch(pathToFileURL(file).toString());
      // Never keep an old picture: a moved or re-made photo must show fresh.
      return new Response(res.body, { status: res.status, headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
    } catch (e) {
      log(`hub ${url.host}/${id}: ${e instanceof Error ? e.message : e}`);
      return new Response("", { status: 404 });
    }
  });

  const ctx: Ctx = {
    db: () => db,
    settings: () => settings as never,
    engine: () => engine,
    win: () => win,
    client: () => client(),
    push,
    remember,
    log,
    data,
    chooseFolder,
    removeWebCopiesOf,
    sendWin,
    appApi: (action, payload) => appApi(action, payload ?? {}),
    message: (m) => {
      lastMessage = m;
      push();
    },
  };
  features = { ...manageApi(ctx), ...libraryApi(ctx) };
  timers.push(binTimer(ctx, features));

  const api: Record<string, (...args: never[]) => unknown> = {
    state: () => state(),
    contextMenu: (items: MenuSpec[], _at: unknown) => popupMenu(items),
    connect: (server: string) => connect(server),
    signIn: (email: string, password: string) => signIn(email, password),
    signOut: async () => {
      await sync?.stop();
      sync = null;
      await client()?.auth.signOut().catch(() => {});
      settings.set({ userId: null, schoolId: null, schoolName: null, role: null });
      await restart();
    },
    chooseLibrary: async () => {
      const dir = await chooseFolder("Photo library folder");
      if (dir) {
        settings.set({ library: dir });
        await restart();
      }
      return dir;
    },
    chooseBackup: async () => {
      const dir = await chooseFolder("Backup folder (another drive)");
      if (dir) settings.set({ backup: dir });
      return dir;
    },
    clearBackup: () => settings.set({ backup: null }),
    set: (key: keyof Settings, value: never) => {
      if (!SETTABLE.includes(key)) throw new Error("bad-setting");
      settings.set({ [key]: value } as Partial<Settings>);
      if (key === "openAtLogin") app.setLoginItemSettings({ openAtLogin: !!value, openAsHidden: true });
      if (key === "language") createMenu();
      if (key === "faces" && value) engine?.queueFaceScan();
      push();
    },
    addWatched: async () => {
      const dir = await chooseFolder("Folder to watch (for example Google Drive or Lightroom exports)");
      if (!dir) return;
      settings.set({ watched: [...settings.get().watched.filter((w) => w.path !== dir), { path: dir, label: path.basename(dir) }] });
      await restart();
    },
    removeWatched: async (dir: string) => {
      settings.set({ watched: settings.get().watched.filter((w) => w.path !== dir) });
      await restart();
    },
    folderFlag: async (dir: string, field: "skip" | "archive", value: boolean) => {
      db.prepare(`insert into folders (path, ${field}) values (?, ?) on conflict (path) do update set ${field} = excluded.${field}`).run(dir, value ? 1 : 0);
      db.prepare("delete from folders where skip = 0 and archive = 0").run();
      if (field === "skip" && value) db.prepare("update photos set missing = 1 where path like ?").run(`${dir}${path.sep}%`);
      if (field === "skip" && !value) await engine?.scan();
      push("photos");
    },
    chooseFolderToFlag: () => chooseFolder("Choose a folder"),
    eventFolderPath: (key: string) => (settings.get().library ? path.join(settings.get().library!, ...key.split("/")) : null),
    openWeb: (sub = "") => shell.openExternal(`${settings.get().server}/${settings.get().language}${sub}`),
    webBase: () => `${settings.get().server}/${settings.get().language}`,
    rescan: () => engine?.scan(),
    findMissing: async () => {
      const dir = await chooseFolder("Where are the missing photos now?");
      return dir ? findMissing(dir) : null;
    },
    missingCount: () => one<{ n: number }>("select count(*) n from photos where missing = 1 and path not like ':%'")?.n ?? 0,
    originalThere: (id: number) => engine?.originalThere(id) ?? false,
    retryAura: () => startAura(),
    retryFailed: () => queue.retryFailed(),

    photo: (id: number) => photo(id),
    rate: (ids: number[], n: number) => setPhotos(ids, "rating", n),
    flag: (ids: number[], n: number) => setPhotos(ids, "flag", n),
    label: (ids: number[], l: string | null) => setPhotos(ids, "label", l),
    best: (ids: number[], count: number) => engine?.bestPhotos(ids, count) ?? [],
    similar: (ids: number[]) => engine?.similarGroups(ids) ?? [],
    moveTo: async (ids: number[], target: { title: string; date: string; className?: string | null }) => {
      const items = (await engine?.moveTo(ids, target)) ?? [];
      remember("move", `${items.length}:${target.title}`, { kind: "move", items });
    },
    renameEvent: (key: string, title: string, date: string) => engine?.renameEvent(key, title, date),
    reveal: (id: number) => {
      const p = one<{ path: string }>("select path from photos where id = ?", id);
      if (p) shell.showItemInFolder(p.path);
    },
    openEditor: async (ids: number[]) => {
      const files = all<{ path: string }>(`select path from photos where id in (${marks(ids.length)})`, ...ids).map((p) => p.path);
      const editor = settings.get().editor;
      const { execFile } = await import("node:child_process");
      if (editor && process.platform === "darwin") execFile("/usr/bin/open", ["-a", editor, ...files]);
      else for (const f of files) await shell.openPath(f);
    },
    chooseEditor: async () => {
      const r = await dialog.showOpenDialog(win!, { title: "Editing app", defaultPath: "/Applications", properties: ["openFile"], filters: [{ name: "Apps", extensions: ["app"] }] });
      if (!r.canceled) settings.set({ editor: r.filePaths[0] });
      push();
    },
    clearEditor: () => settings.set({ editor: null }),
    duplicates: () => engine?.duplicates() ?? [],
    cleanup: () => cleanupReport(),
    bookOptions: () => ({
      years: all<{ year: string }>("select distinct year from photos where year is not null and missing = 0 order by year desc").map((r) => r.year),
      grades: all<{ stage: string | null; grade: string }>("select distinct stage, grade from students where grade is not null").map((r) => r.grade),
      classes: classes(),
    }),
    bookPreview: (o: Partial<BookSpec>) => {
      const spec = bookSpec(o);
      const pages = bookPages(db, spec);
      return { pages: pages.length, html: bookHtml(spec, pages) };
    },
    makeBook: async (o: Partial<BookSpec>) => {
      const spec = bookSpec(o);
      const who = spec.studentId ? one<{ name_en: string | null; name_ar: string | null }>("select name_en, name_ar from students where id = ?", spec.studentId) : null;
      const base = safeName([spec.kind === "graduation" ? "Graduation" : "Yearbook", spec.year, spec.grade, who?.name_en ?? who?.name_ar].filter(Boolean).join(" "));
      const r = await dialog.showSaveDialog(win!, { title: "Save the book", defaultPath: path.join(app.getPath("desktop"), `${base}.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (r.canceled || !r.filePath) return null;
      const out = await printBook(spec, r.filePath);
      shell.showItemInFolder(out.file);
      return out;
    },
    // One book per student in a class, all into one folder.
    makeClassBooks: async (o: Partial<BookSpec>) => {
      const dir = await chooseFolder("Folder for the books");
      if (!dir || !o.className) return null;
      const list = all<{ id: string; name_en: string | null; name_ar: string | null }>("select id, name_en, name_ar from students where class_name = ? order by coalesce(name_en, name_ar)", o.className);
      let made = 0;
      for (const st of list) {
        const spec = bookSpec({ ...o, studentId: st.id });
        const file = path.join(dir, `${safeName(`${o.className} ${st.name_en ?? st.name_ar ?? st.id}`)}.pdf`);
        lastMessage = `book:${made + 1}/${list.length}`;
        push();
        await printBook(spec, file).then(() => made++).catch(() => {});
      }
      lastMessage = "";
      shell.openPath(dir);
      return { made, total: list.length };
    },
    newAlbum: (name: string, rule: Record<string, unknown> | null, ids: number[] = []) => {
      const r = db.prepare("insert into albums (name, rule, added_at) values (?, ?, ?)").run(name.slice(0, 80), rule ? JSON.stringify(rule) : null, Date.now());
      const id = Number(r.lastInsertRowid);
      const add = db.prepare("insert or ignore into album_photos (album_id, photo_id) values (?, ?)");
      tx(db, () => ids.forEach((p) => add.run(id, p)));
      push("photos");
      return id;
    },
    addToAlbum: (albumId: number, ids: number[]) => {
      const add = db.prepare("insert or ignore into album_photos (album_id, photo_id) values (?, ?)");
      tx(db, () => ids.forEach((p) => add.run(albumId, p)));
      push("photos");
    },
    removeFromAlbum: (albumId: number, ids: number[]) => {
      db.prepare(`delete from album_photos where album_id = ? and photo_id in (${marks(ids.length)})`).run(albumId, ...ids);
      push("photos");
    },
    renameAlbum: (albumId: number, name: string) => db.prepare("update albums set name = ? where id = ?").run(name.slice(0, 80), albumId),
    deleteAlbum: (albumId: number) => {
      db.prepare("delete from albums where id = ?").run(albumId);
      push("photos");
    },
    filingPlan: () => {
      const lib = settings.get().library;
      if (!lib) return null;
      const { moves, unsure } = planFiling(db, lib);
      return { count: moves.length, unsure: unsure.length, groups: groupMoves(moves).slice(0, 200).map((g) => ({ title: g.title, date: g.date, className: g.className, n: g.ids.length })) };
    },
    applyFiling: () => applyFiling(),
    cleanupList: (kind: string) => cleanupList(kind),
    cleanSafe: async () => {
      const r = await cleanupReport();
      const ids = exactCopies(db).flatMap((g) => g.extra);
      if (ids.length) await binPhotos(ids);
      const s = settings.get();
      const folders = s.library ? await removeEmptyFolders(await emptyFolders(s.library)) : 0;
      await rm(path.join(data("cache"), "previews"), { recursive: true, force: true });
      push("photos");
      return { copies: ids.length, folders, freed: r.exact.size + r.cache };
    },
    removeEmptyFolders: async () => {
      const s = settings.get();
      return s.library ? removeEmptyFolders(await emptyFolders(s.library)) : 0;
    },
    clearPreviews: () => rm(path.join(data("cache"), "previews"), { recursive: true, force: true }),
    openBin: () => send("go:cleanup"),

    importSource: async (dir?: string) => {
      if (!dir) dir = (await chooseFolder("Photos to import (memory card, phone or photographer's folder)")) ?? undefined;
      if (!dir) return null;
      const files = await listFiles(dir);
      const lib = settings.get().library;
      if (lib && path.resolve(dir).startsWith(path.resolve(lib) + path.sep)) throw new Error("inside-library");
      const { default: exifr } = await import("exifr");
      let first: string | null = null;
      let days = new Set<string>();
      for (const f of files.slice(0, 400)) {
        const t = await exifr.parse(f, ["DateTimeOriginal"]).catch(() => null);
        const d = t?.DateTimeOriginal;
        if (d instanceof Date && !Number.isNaN(d.getTime())) {
          const iso = d.toISOString().slice(0, 10);
          days.add(iso);
          if (!first || iso < first) first = iso;
        }
      }
      importFiles = files;
      return { dir, name: path.basename(dir), count: files.length, firstDate: first, days: [...days].sort(), raw: files.filter((f) => /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2)$/i.test(f)).length };
    },
    // Several folders at once: each becomes its own event, named and dated
    // from the folder name where it can be read.
    importSources: async (dirs?: string[]) => {
      if (!dirs?.length) {
        const r = await dialog.showOpenDialog(win!, { title: "Folders to import (choose several with ⌘ or ⇧)", properties: ["openDirectory", "multiSelections"] });
        if (r.canceled) return null;
        dirs = r.filePaths;
      }
      const lib = settings.get().library;
      const { default: exifr } = await import("exifr");
      importBatch = new Map();
      const out = [];
      for (const dir of dirs) {
        if (lib && path.resolve(dir).startsWith(path.resolve(lib) + path.sep)) continue;
        const files = await listFiles(dir);
        const guess = guessEvent(path.basename(dir));
        let first: string | null = guess.date;
        if (!first) {
          for (const f of files.slice(0, 40)) {
            const t = await exifr.parse(f, ["DateTimeOriginal"]).catch(() => null);
            const d = t?.DateTimeOriginal;
            if (d instanceof Date && !Number.isNaN(d.getTime())) {
              const iso = d.toISOString().slice(0, 10);
              if (!first || iso < first) first = iso;
            }
          }
        }
        importBatch.set(dir, files);
        out.push({ dir, name: path.basename(dir), count: files.length, title: guess.title || (guess.date ? "Event" : path.basename(dir)), date: first });
      }
      return out;
    },
    runImports: async (o: { items: { dir: string; title: string; date: string | null; className: string | null }[]; skipDuplicates: boolean; archive: boolean }) => {
      const lib = settings.get().library;
      if (!lib) throw new Error("no-library");
      const total = o.items.reduce((n, it) => n + (importBatch.get(it.dir)?.length ?? 0), 0);
      let before = 0;
      const sum = { copied: 0, duplicates: 0, failed: 0, events: 0 };
      for (const it of o.items) {
        const files = importBatch.get(it.dir) ?? [];
        if (!files.length || it.title.trim().length < 2) continue;
        const r = await importPhotos({
          db,
          library: lib,
          files,
          title: it.title.trim(),
          date: it.date,
          className: it.className,
          byDay: false,
          skipDuplicates: o.skipDuplicates,
          onProgress: (done) => sendWin("progress", { done: before + done, total }),
        });
        before += files.length;
        if (o.archive) for (const f of r.folders) db.prepare("insert into folders (path, archive) values (?, 1) on conflict (path) do update set archive = 1").run(f);
        sum.copied += r.copied;
        sum.duplicates += r.duplicates;
        sum.failed += r.failed;
        sum.events++;
      }
      remember("import", `${sum.copied}:${sum.events} events`, null);
      importBatch = new Map();
      push("photos");
      return sum;
    },
    volumes: async () => {
      if (process.platform !== "darwin") return [];
      const { readdir } = await import("node:fs/promises");
      const vols = await readdir("/Volumes").catch(() => [] as string[]);
      return vols.filter((v) => existsSync(path.join("/Volumes", v, "DCIM"))).map((v) => ({ name: v, path: path.join("/Volumes", v, "DCIM") }));
    },
    runImport: async (o: { title: string; date: string | null; className: string | null; byDay: boolean; skipDuplicates: boolean; archive: boolean }) => {
      const lib = settings.get().library;
      if (!lib) throw new Error("no-library");
      const r = await importPhotos({
        db,
        library: lib,
        files: importFiles,
        title: o.title,
        date: o.date,
        className: o.className,
        byDay: o.byDay,
        skipDuplicates: o.skipDuplicates,
        onProgress: (done, total) => sendWin("progress", { done, total }),
      });
      if (o.archive) for (const f of r.folders) db.prepare("insert into folders (path, archive) values (?, 1) on conflict (path) do update set archive = 1").run(f);
      remember("import", `${r.copied}:${o.title}`, null);
      importFiles = [];
      push("photos");
      return r;
    },

    previewStudents: (file?: string) => previewStudents(file),
    pickPortraits: () => chooseFolder("Folder of student portraits (named by student ID)"),
    commitStudents: (folder: string | null) => commitStudents(folder),
    classes: () => classes(),
    students: (f: { className?: string; search?: string; year?: string; term?: string; event?: string }) => students(f),
    student: (id: string) => one("select * from students where id = ?", id),
    setCanPost: (id: string, value: boolean) => {
      const before = one<{ can_post: number }>("select can_post from students where id = ?", id);
      db.prepare("update students set can_post = ? where id = ?").run(value ? 1 : 0, id);
      remember("canPost", id, { kind: "canPost", id, value: before?.can_post ?? 1 });
      const photoIds = all<{ photo_id: number }>("select distinct photo_id from faces where student_id = ? and status in ('confirmed', 'manual')", id).map((r) => r.photo_id);
      syncOptedOut(photoIds);
      const sb = client();
      const s = settings.get();
      if (sb && s.schoolId) sb.from("students").update({ consent_social: value ? "yes" : "no" }).eq("school_id", s.schoolId).eq("student_code", id).then(() => {});
      push("students");
    },
    addStudent: (s: { id: string; name_en: string; name_ar: string; class_name: string; kind?: string; linkTo?: string }) => {
      const kind = ["student", "teacher", "staff", "parent", "visitor"].includes(s.kind ?? "") ? s.kind! : "student";
      const id = s.id?.trim() || `${kind === "student" ? "X" : kind[0].toUpperCase()}${Date.now().toString(36)}`;
      db.prepare("insert into students (id, name_en, name_ar, class_name, stage, grade, can_post, kind, added_at) values (?, ?, ?, ?, ?, ?, 1, ?, ?)").run(
        id, s.name_en || null, s.name_ar || null, kind === "student" ? s.class_name || null : null, null, null, kind, Date.now(),
      );
      // A parent is linked to their student.
      if (s.linkTo) db.prepare("insert or ignore into links (a, b, kind) values (?, ?, 'parent')").run(id, s.linkTo);
      push("students");
      return id;
    },
    removeStudent: (id: string) => {
      db.prepare("delete from faces where student_id = ? and status = 'portrait'").run(id);
      db.prepare("update faces set student_id = null, status = 'unknown' where student_id = ?").run(id);
      db.prepare("delete from students where id = ?").run(id);
      push("students");
    },

    suggestions: (limit = 40) => {
      const groups = all<{ suggest_id: string; n: number; best: number }>(
        `select f.suggest_id, count(*) n, max(f.suggest_score) best from faces f join photos p on p.id = f.photo_id
         where f.status = 'suggested' and f.suggest_score >= ${SHOW_FROM} and p.missing = 0 group by f.suggest_id order by n desc limit ?`,
        limit,
      );
      return groups.map((g) => ({
        student: one("select * from students where id = ?", g.suggest_id),
        faces: all(`select f.id, f.photo_id, f.suggest_score from faces f join photos p on p.id = f.photo_id where f.status = 'suggested' and f.suggest_score >= ${SHOW_FROM} and f.suggest_id = ? and p.missing = 0 order by f.suggest_score desc limit 60`, g.suggest_id),
        n: g.n,
      }));
    },
    people: (f: { className?: string } = {}) => people(f),
    person: (id: string) => person(id),
    setMainFace: (studentId: string, faceId: number | null) => db.prepare("update students set main_face = ? where id = ?").run(faceId, studentId),
    isThis: (studentIds?: string[]) => isThisQueue(studentIds),
    unknownGroups: () => (engine?.unknownGroups() ?? []).map((ids) => ({ ids, photos: [...new Set(faceRowsFor(ids).map((f) => f.photo_id))].length })),
    confirmFaces: (ids: number[], studentId: string) => confirmFaces(ids, studentId),
    faceGuesses: (faceId: number) =>
      (engine?.guesses(faceId) ?? []).map((g) => ({ ...g, student: one("select id, name_en, name_ar, class_name, kind, portrait, can_post from students where id = ?", g.studentId) })).filter((g) => g.student),
    rejectFaces: (ids: number[]) => rejectFaces(ids),
    hideFaces: (ids: number[]) => hideFaces(ids),
    tagPhotos: (ids: number[], studentId: string) => tagPhotos(ids, studentId),
    untagPhotos: (ids: number[], studentId: string) => {
      const faces = all<{ id: number }>(`select id from faces where photo_id in (${marks(ids.length)}) and student_id = ? and status in ('confirmed', 'manual', 'suggested')`, ...ids, studentId).map((f) => f.id);
      if (faces.length) rejectFaces(faces);
    },
    rescanFaces: () => {
      db.prepare("update photos set faces_scanned = 0 where faces_scanned = -1").run();
      engine?.queueFaceScan();
      engine?.rematch();
    },
    coverage: (f: { year?: string; term?: string; event?: string }) => coverage(f),
    periods: () => all("select distinct year, term from photos where year is not null and missing = 0 order by year desc, term desc"),

    newPost: (ids: number[]) => newPost(ids),
    cancelPost: () => {
      postCancelled = true;
      lastMessage = "";
      push();
    },
    app: (action: string, payload?: Record<string, unknown>) => appApi(action, payload ?? {}),
    serverSummary: async () => {
      const sb = client();
      const s = settings.get();
      if (!sb || !s.schoolId) return null;
      return summary(sb, s.schoolId).catch(() => null);
    },
    undo: () => undo(),
    updateBackups: () => updateBackups(),
    restoreBackup: (name: string) => restoreBackup(name),
    history: () => all("select id, at, action, detail, undo is not null as can_undo from history order by id desc limit 200"),
    search: (q: string) => search(q),
    showFile: (file: string) => shell.showItemInFolder(file),
    ...features,
  };
  let importFiles: string[] = [];
  let importBatch = new Map<string, string[]>();

  ipcMain.handle("call", async (_e, name: string, ...args: unknown[]) => {
    const fn = api[name];
    if (!fn) return { ok: false, error: "unknown" };
    try {
      const value = await fn(...(args as never[]));
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "error" };
    }
  });

  app.setLoginItemSettings({ openAtLogin: settings.get().openAtLogin, openAsHidden: true });
  if (!settings.get().supabaseUrl) await connect(settings.get().server || DEFAULT_SERVER).catch(() => {});
  createMenu();
  createWindow();
  createTray();
  if (process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAsHidden) win?.hide();
  await restart();
  startAura();
  timers.push(setInterval(() => push(), 3000));
  timers.push(setInterval(() => checkWebUploads(), 60_000));
  setTimeout(() => checkWebUploads(), 8000);

  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on("before-quit", () => {
  quitting = true;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  timers.forEach((t) => clearInterval(t));
  timers = [];
});
app.on("window-all-closed", () => {
  // Stay in the menu bar.
});
