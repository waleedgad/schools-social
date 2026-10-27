import { existsSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { watch, type FSWatcher } from "chokidar";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, safeStorage, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import { openDb, tx, type Db } from "./core/db";
import { Engine, importPhotos, listFiles } from "./core/engine";
import { isLibraryFile } from "./core/library";
import { UploadQueue } from "./core/queue";
import { JsonStore } from "./core/store";
import { parseRows, readSheet, type StudentRow } from "./core/students";
import { LibrarySync } from "./core/sync";
import { createDraft, pushStudents, setOptedOut, summary } from "./core/web";

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
};

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
let supabase: SupabaseClient | null = null;
let sync: LibrarySync | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastMessage = "";
let watchers: FSWatcher[] = [];
let pushTimer: NodeJS.Timeout | null = null;
let changed = new Set<string>();

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
    const list = [...changed];
    changed = new Set();
    win?.webContents.send("state", state(), list);
    const q = queue.stats();
    tray?.setToolTip(`School Social Hub · ${engine?.status.processing ?? 0} to read · ${q.pending} to send`);
  }, 500);
}

function remember(action: string, detail: string, undo: unknown) {
  db.prepare("insert into history (at, action, detail, undo) values (?, ?, ?, ?)").run(Date.now(), action, detail, undo ? JSON.stringify(undo) : null);
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
      onChange: push,
      onPhotoReady: photoReady,
      log: (m) => {
        lastMessage = m;
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

// ---------- Library queries ----------

type Filter = {
  event?: string;
  year?: string;
  term?: string;
  className?: string;
  album?: string;
  student?: string;
  search?: string;
  minRating?: number;
  flag?: number;
  ids?: number[];
  sort?: "time" | "quality" | "name";
  limit?: number;
};

const PHOTO_COLUMNS = `p.id, p.name, p.width, p.height, p.rating, p.flag, p.label, p.face_count, p.is_raw, p.quality, p.taken_at,
  p.event_key, p.event_title, p.class_name, p.remote_id, p.thumb, p.faces_scanned,
  (select count(*) from photos r where r.pair_of = p.id) as has_raw,
  (select count(*) from photos e where e.edited_of = p.id and e.missing = 0) as edits,
  (select count(*) from faces f where f.photo_id = p.id and f.status in ('confirmed', 'manual')) as tagged,
  (select count(*) from faces f where f.photo_id = p.id and f.status = 'suggested') as suggested,
  (select count(*) from faces f join students s on s.id = f.student_id where f.photo_id = p.id and f.status in ('confirmed', 'manual') and s.can_post = 0) as no_post`;

function photos(f: Filter) {
  const where = ["p.missing = 0", "p.pair_of is null", "p.dup_of is null", "p.edited_of is null"];
  const args: unknown[] = [];
  if (f.ids?.length) {
    where.push(`p.id in (${marks(f.ids.length)})`);
    args.push(...f.ids);
  }
  if (f.event) {
    where.push("p.event_key = ?");
    args.push(f.event);
  }
  if (f.year) {
    where.push("p.year = ?");
    args.push(f.year);
  }
  if (f.term) {
    where.push("p.term = ?");
    args.push(f.term);
  }
  if (f.className) {
    where.push(`(p.class_name = ? or exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and f.status in ('confirmed','manual') and s.class_name = ?))`);
    args.push(f.className, f.className);
  }
  if (f.student) {
    where.push("exists (select 1 from faces f where f.photo_id = p.id and f.student_id = ? and f.status in ('confirmed', 'manual'))");
    args.push(f.student);
  }
  if (f.minRating) {
    where.push("p.rating >= ?");
    args.push(f.minRating);
  }
  if (f.flag !== undefined && f.flag !== null) {
    where.push("p.flag = ?");
    args.push(f.flag);
  }
  if (f.search) {
    where.push("(p.name like ? or p.event_title like ? or p.class_name like ?)");
    args.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`);
  }
  switch (f.album) {
    case "picks":
      where.push("p.flag = 1");
      break;
    case "rejected":
      where.push("p.flag = -1");
      break;
    case "five":
      where.push("p.rating = 5");
      break;
    case "week":
      where.push("p.added_at > ?");
      args.push(Date.now() - 7 * 86400_000);
      break;
    case "untagged":
      where.push("exists (select 1 from faces f where f.photo_id = p.id and f.status in ('unknown', 'suggested'))");
      break;
    case "nofaces":
      where.push("p.faces_scanned = 1 and p.face_count = 0");
      break;
    case "notsent":
      where.push("p.remote_id is null and p.flag = 1");
      break;
    case "sent":
      where.push("p.remote_id is not null");
      break;
    case "nopost":
      where.push("exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and f.status in ('confirmed','manual') and s.can_post = 0)");
      break;
    case "noevent":
      where.push("p.event_key is null");
      break;
    case "raw":
      where.push("(p.is_raw = 1 or exists (select 1 from photos r where r.pair_of = p.id))");
      break;
  }
  const order = f.sort === "quality" ? "p.quality desc" : f.sort === "name" ? "p.name" : "p.taken_at, p.name";
  return all(`select ${PHOTO_COLUMNS} from photos p where ${where.join(" and ")} order by ${order} limit ?`, ...args, f.limit ?? 6000);
}

function tree() {
  const rows = all<{ year: string | null; term: string | null; event_key: string | null; event_title: string | null; event_date: string | null; n: number; picks: number }>(
    `select year, term, event_key, event_title, max(event_date) event_date, count(*) n, sum(flag = 1) picks from photos
     where missing = 0 and pair_of is null and dup_of is null and edited_of is null group by year, term, event_key order by year desc, term desc, event_date desc`,
  );
  const classes = all<{ event_key: string; class_name: string; n: number }>(
    "select event_key, class_name, count(*) n from photos where missing = 0 and class_name is not null and pair_of is null and dup_of is null group by event_key, class_name order by class_name",
  );
  return { rows, classes };
}

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

function students(f: { className?: string; search?: string; year?: string; term?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.className) {
    where.push("s.class_name = ?");
    args.push(f.className);
  }
  if (f.search) {
    where.push("(s.name_en like ? or s.name_ar like ? or s.id like ? or s.class_name like ?)");
    args.push(...Array(4).fill(`%${f.search}%`));
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
  return all(
    `select s.*, (select count(distinct f.photo_id) from faces f join photos p on p.id = f.photo_id
        where f.student_id = s.id and f.status in ('confirmed', 'manual') and p.missing = 0 ${period.length ? "and " + period.join(" and ") : ""}) as photos,
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

// The website blocks a post with a photo of a child who can't appear.
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
  const before = faceRowsFor(faceIds);
  db.prepare(`update faces set student_id = ?, status = 'confirmed', suggest_id = null, suggest_score = null where id in (${marks(faceIds.length)})`).run(studentId, ...faceIds);
  remember("tag", `${faceIds.length}:${studentId}`, { kind: "faces", rows: before });
  syncOptedOut([...new Set(before.map((r) => r.photo_id))]);
  setTimeout(() => engine?.rematch([studentId]), 50);
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

// Tag a child in photos where no face was found (from behind, in costume).
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

function coverage(f: { year?: string; term?: string }) {
  const rows = students(f) as { id: string; class_name: string | null; stage: string | null; grade: string | null; photos: number }[];
  const byClass = new Map<string, { className: string; stage: string | null; grade: string | null; students: number; zero: number; low: number; photos: number }>();
  for (const r of rows) {
    const k = r.class_name ?? "—";
    const c = byClass.get(k) ?? { className: k, stage: r.stage, grade: r.grade, students: 0, zero: 0, low: 0, photos: 0 };
    c.students++;
    c.photos += r.photos;
    if (r.photos === 0) c.zero++;
    else if (r.photos < 3) c.low++;
    byClass.set(k, c);
  }
  return [...byClass.values()];
}

// ---------- Posts ----------

async function newPost(ids: number[]) {
  const sb = client();
  const s = settings.get();
  if (!sb || !s.userId || !s.schoolId || !sync) throw new Error("not-signed-in");
  const rows = all<{ id: number; path: string; remote_id: string | null; taken_at: string | null }>(
    `select id, path, remote_id, taken_at from photos where id in (${marks(ids.length)}) order by taken_at`,
    ...ids,
  ).slice(0, 20);
  for (const r of rows) if (!r.remote_id) await sync.enqueue(r.path);
  // Wait for the photos to reach the website (up to three minutes).
  const started = Date.now();
  for (;;) {
    const sent = all<{ remote_id: string | null }>(`select remote_id from photos where id in (${marks(rows.length)})`, ...rows.map((r) => r.id));
    lastMessage = `sending:${sent.filter((x) => x.remote_id).length}/${rows.length}`;
    push();
    if (sent.every((x) => x.remote_id)) break;
    if (Date.now() - started > 180_000) throw new Error("upload-slow");
    await new Promise((r) => setTimeout(r, 1500));
  }
  const fresh = all<{ id: number; path: string; remote_id: string; taken_at: string | null }>(
    `select id, path, remote_id, taken_at from photos where id in (${marks(rows.length)}) order by taken_at`,
    ...rows.map((r) => r.id),
  );
  const eventId = await sync.eventFor(fresh[0].path, fresh[0].taken_at ? new Date(fresh[0].taken_at) : null).catch(() => null);
  const postId = await createDraft(sb, { schoolId: s.schoolId, userId: s.userId, eventId, photoIds: fresh.map((r) => r.remote_id) });
  lastMessage = "";
  remember("post", postId, null);
  return postId;
}

// ---------- Search (⌘K) ----------

function search(q: string) {
  const like = `%${q}%`;
  return {
    students: all("select id, name_en, name_ar, class_name from students where name_en like ? or name_ar like ? or id like ? order by name_en limit 8", like, like, like),
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
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#f7f6f2",
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

function send(command: string) {
  win?.show();
  win?.webContents.send("command", command);
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
  });
  queue = new UploadQueue(data("queue.json"));
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
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response("", { status: 404 });
    }
  });

  const api: Record<string, (...args: never[]) => unknown> = {
    state: () => state(),
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
      const allowed: (keyof Settings)[] = ["language", "sendMode", "faces", "paused", "openAtLogin", "textSize", "theme", "accent", "quietFrom", "quietTo", "alerts", "setupDone"];
      if (!allowed.includes(key)) throw new Error("bad-setting");
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
    retryFailed: () => queue.retryFailed(),

    tree: () => tree(),
    photos: (f: Filter) => photos(f),
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
    bin: async (ids: number[]) => {
      const rows = all<{ id: number; path: string }>(`select id, path from photos where id in (${marks(ids.length)})`, ...ids);
      for (const r of rows) {
        await shell.trashItem(r.path).catch(() => {});
        db.prepare("update photos set missing = 1 where id = ?").run(r.id);
      }
      remember("bin", `${rows.length}`, null);
      push("photos");
      return rows.length;
    },
    duplicates: () => engine?.duplicates() ?? [],

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
        onProgress: (done, total) => win?.webContents.send("progress", { done, total }),
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
    students: (f: { className?: string; search?: string; year?: string; term?: string }) => students(f),
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
    addStudent: (s: { id: string; name_en: string; name_ar: string; class_name: string }) => {
      const id = s.id?.trim() || `X${Date.now().toString(36)}`;
      db.prepare("insert into students (id, name_en, name_ar, class_name, stage, grade, can_post, added_at) values (?, ?, ?, ?, ?, ?, 1, ?)").run(
        id, s.name_en || null, s.name_ar || null, s.class_name || null, null, null, Date.now(),
      );
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
         where f.status = 'suggested' and p.missing = 0 group by f.suggest_id order by n desc limit ?`,
        limit,
      );
      return groups.map((g) => ({
        student: one("select * from students where id = ?", g.suggest_id),
        faces: all("select f.id, f.photo_id, f.suggest_score from faces f join photos p on p.id = f.photo_id where f.status = 'suggested' and f.suggest_id = ? and p.missing = 0 order by f.suggest_score desc limit 60", g.suggest_id),
        n: g.n,
      }));
    },
    unknownGroups: () => (engine?.unknownGroups() ?? []).map((ids) => ({ ids, photos: [...new Set(faceRowsFor(ids).map((f) => f.photo_id))].length })),
    confirmFaces: (ids: number[], studentId: string) => confirmFaces(ids, studentId),
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
    coverage: (f: { year?: string; term?: string }) => coverage(f),
    periods: () => all("select distinct year, term from photos where year is not null and missing = 0 order by year desc, term desc"),

    newPost: (ids: number[]) => newPost(ids),
    serverSummary: async () => {
      const sb = client();
      const s = settings.get();
      if (!sb || !s.schoolId) return null;
      return summary(sb, s.schoolId).catch(() => null);
    },
    undo: () => undo(),
    history: () => all("select id, at, action, detail, undo is not null as can_undo from history order by id desc limit 200"),
    search: (q: string) => search(q),
    showFile: (file: string) => shell.showItemInFolder(file),
    reportProblem: (text: string) =>
      shell.openExternal(`mailto:?subject=${encodeURIComponent(`School Social Hub ${app.getVersion()} problem`)}&body=${encodeURIComponent(`${text}\n\n---\n${process.platform} ${process.arch} · ${app.getVersion()}`)}`),
  };
  let importFiles: string[] = [];

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
  setInterval(() => push(), 3000);

  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  // Stay in the menu bar.
});
