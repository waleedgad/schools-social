import { _electron, expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, utimesSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Release 0.10, items 4-5: duplicates and copies, RAW + JPEG pairs. The
// library never loses or doubles a photo: "send copies to the Bin" never
// takes the last copy or a posted or named photo, Undo brings them back, and
// a RAW with its JPEG is one photo everywhere.
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };
type Row = { id: number; path: string; hash: string | null; dup_of: number | null; pair_of: number | null; missing: number; posts: number };

const call = async (win: Page, f: string, ...a: unknown[]) => {
  const r = await win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
  if (!r.ok) throw new Error(`${f}: ${JSON.stringify(r)}`);
  return r.value;
};
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function photo(seed: number, w = 640, h = 480) {
  // Each one looks different (big shapes in different places), with fine
  // noise on top so it's a realistic size.
  const raw = Buffer.alloc(w * h * 3);
  const cx = ((seed * 137) % 9) / 9, cy = ((seed * 61) % 7) / 7;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const inBox = Math.abs(x / w - cx) < 0.18 && Math.abs(y / h - cy) < 0.22;
      const band = Math.floor((x / w) * (2 + (seed % 5))) % 2;
      const v = inBox ? 230 : band ? 40 + seed * 9 : 120;
      const n = ((i * 2654435761) >>> 27) ^ (seed & 7);
      raw[i] = v ^ n; raw[i + 1] = (v + seed * 23) & 255 ^ n; raw[i + 2] = (255 - v) ^ n;
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}
// A camera RAW file carries a full-size JPEG preview; the app reads that.
const rawFile = (jpeg: Buffer) => Buffer.concat([Buffer.from("II*\u0000fake camera raw for the robot test\u0000"), jpeg]);

function put(file: string, bytes: Buffer) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

function setup() {
  const base = mkdtempSync(path.join(tmpdir(), "hub-lib-"));
  const lib = path.join(base, "Photos");
  const volumes = path.join(base, "Volumes");
  mkdirSync(lib, { recursive: true });
  mkdirSync(volumes, { recursive: true });
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  return { base, lib, volumes, userData, dbFile: path.join(userData, "library.db") };
}

async function launch(userData: string, volumes: string, env: Record<string, string> = {}) {
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1", HUB_VOLUMES: volumes, ...env },
  });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  await expect(win.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 30_000 });
  return { app, win, errors };
}

function rows(dbFile: string) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return db.prepare("select id, path, hash, dup_of, pair_of, missing, posts from photos order by id").all() as unknown as Row[];
  } finally {
    db.close();
  }
}
function write(dbFile: string, sql: string, ...args: (string | number | null)[]) {
  const db = new DatabaseSync(dbFile);
  try {
    db.exec("pragma busy_timeout = 5000");
    db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
}
const byName = (all: Row[], rel: string) => all.find((r) => r.path.endsWith(rel.split("/").join(path.sep)))!;
// Photos the library shows: one for each photo, whatever its copies.
const shown = (all: Row[]) => all.filter((r) => !r.missing && r.dup_of == null && r.pair_of == null);
async function settled(win: Page, dbFile: string, n: number) {
  await expect.poll(() => rows(dbFile).filter((r) => !r.missing && r.hash).length, { timeout: 90_000 }).toBe(n);
  await expect.poll(async () => ((await call(win, "state")) as { engine?: { processing?: number } }).engine?.processing ?? 0, { timeout: 60_000 }).toBe(0);
}

test("copies go to the Bin safely: never the last copy, never a posted or named photo, and Undo brings them back", async () => {
  test.setTimeout(240_000);
  const { lib, volumes, userData, dbFile } = setup();
  const sports = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day");
  const books = path.join(lib, "2026-2027", "Term 1", "2026-10-20 Book week");
  const p = await Promise.all([1, 2, 3, 4].map((i) => photo(i)));
  p.forEach((b, i) => put(path.join(sports, `IMG_000${i + 1}.jpg`), b));
  put(path.join(books, "IMG_0001.jpg"), p[0]); // two exact copies of photo 1
  put(path.join(books, "IMG_0001 copy.jpg"), p[0]);
  put(path.join(books, "IMG_0002.jpg"), p[1]); // a copy that was posted
  put(path.join(books, "IMG_0004.jpg"), p[3]); // a copy with a student named
  put(path.join(books, "IMG_0003-small.jpg"), await sharp(p[2]).resize(320, 240).jpeg({ quality: 80 }).toBuffer());

  const { app, win, errors } = await launch(userData, volumes);
  await settled(win, dbFile, 9);
  let all = rows(dbFile);
  expect(shown(all).length, "4 photos, whatever their copies").toBe(5); // the small one is a separate file until cleaned
  const copyOf = (i: number) => all.filter((r) => r.hash === sha(p[i - 1]) && r.dup_of != null);
  expect(copyOf(1).length).toBe(2);
  write(dbFile, "update photos set posts = 1 where id = ?", copyOf(2)[0].id);
  write(dbFile, "insert into students (id, name_en, class_name, added_at) values ('s1', 'Mona Adel', '3A', 0)");
  write(dbFile, "insert into faces (photo_id, x, y, w, h, student_id, status) values (?, 0.2, 0.2, 0.2, 0.2, 's1', 'confirmed')", copyOf(4)[0].id);

  // What Clean up offers: only the two plain copies of photo 1, and the
  // small copy of photo 3. Never the posted or the named copy.
  const exact = (await call(win, "cleanupList", "exact")) as { groups: { keep: number; extra: number[] }[] };
  expect(exact.groups.flatMap((g) => g.extra).sort()).toEqual(copyOf(1).map((r) => r.id).sort());
  const sizes = (await call(win, "cleanupList", "sizes")) as { groups: { keep: number; extra: number[] }[] };
  const small = byName(all, "Book week/IMG_0003-small.jpg");
  expect(sizes.groups.map((g) => g.extra), JSON.stringify(sizes.groups.map((g) => [g.keep, ...g.extra].map((id) => path.basename(byId(all, id).path))))).toEqual([[small.id]]);
  expect(sizes.groups[0].keep).toBe(byName(all, "Sports day/IMG_0003.jpg").id);

  // "Clean everything safe": the two copies go to the Bin, the photo stays.
  const r = (await call(win, "cleanSafe")) as { copies: number };
  expect(r.copies).toBe(2);
  all = rows(dbFile);
  expect(all.filter((x) => x.hash === sha(p[0]) && !x.missing).length, "one copy of photo 1 left").toBe(1);
  expect(readdirSync(path.join(lib, "_Bin"), { recursive: true }).filter((f) => String(f).endsWith(".jpg")).length).toBe(2);
  expect(existsSync(path.join(books, "IMG_0002.jpg")), "the posted copy stays").toBe(true);
  expect(existsSync(path.join(books, "IMG_0004.jpg")), "the named copy stays").toBe(true);
  // Undo: both copies are back where they were.
  await call(win, "undo");
  await expect.poll(() => existsSync(path.join(books, "IMG_0001.jpg")) && existsSync(path.join(books, "IMG_0001 copy.jpg"))).toBe(true);
  all = rows(dbFile);
  expect(all.filter((x) => x.hash === sha(p[0]) && !x.missing).length).toBe(3);
  expect(shown(all).length).toBe(5);

  // B-59: binning the photo its copies hang off: a copy takes its place, so the
  // photo is still in the library. Undo makes it the main photo again.
  const orig2 = byName(all, "Sports day/IMG_0002.jpg");
  await call(win, "bin", [orig2.id]);
  all = rows(dbFile);
  expect(shown(all).map((x) => x.id), "the posted copy shows instead").toContain(copyOf(2)[0]?.id ?? byName(all, "Book week/IMG_0002.jpg").id);
  expect(shown(all).length).toBe(5);
  await call(win, "undo");
  await expect.poll(() => shown(rows(dbFile)).map((x) => x.id)).toContain(orig2.id);
  all = rows(dbFile);
  expect(shown(all).length, "no photo shown twice").toBe(5);
  expect(byName(all, "Book week/IMG_0002.jpg").dup_of).toBe(orig2.id);

  // A list on screen that's out of date: the photo to keep was binned since.
  // "Bin the ticked" then bins nothing from that group.
  all = rows(dbFile);
  const orig3 = byName(all, "Sports day/IMG_0003.jpg");
  await call(win, "bin", [orig3.id]);
  expect(await call(win, "cleanBin", [{ keep: orig3.id, ids: [small.id] }])).toBe(0);
  expect(existsSync(small.path), "the last copy of photo 3 stays").toBe(true);
  await call(win, "undo");
  await expect.poll(() => existsSync(orig3.path)).toBe(true);

  // Deleted in Finder (not through the app): the copy shows instead too.
  all = rows(dbFile);
  rmSync(byName(all, "Sports day/IMG_0004.jpg").path);
  await expect.poll(() => shown(rows(dbFile)).map((x) => x.path), { timeout: 30_000 }).toContain(path.join(books, "IMG_0004.jpg"));
  expect(shown(rows(dbFile)).length).toBe(5);
  expect(errors).toEqual([]);
  await app.close();
});

test("a RAW and its JPEG are one photo: counted once, moved and binned together, and come back together", async () => {
  test.setTimeout(240_000);
  const { base, lib, volumes, userData, dbFile } = setup();
  // A camera card with RAW + JPEG pairs. Imports put the RAWs in a "RAW" folder.
  const card = path.join(volumes, "CARD1", "DCIM", "100CANON");
  const j = await Promise.all([1, 2].map((i) => photo(i + 20)));
  for (const [i, b] of j.entries()) {
    put(path.join(card, `IMG_010${i}.JPG`), b);
    put(path.join(card, `IMG_010${i}.CR2`), rawFile(b));
  }
  const { app, win, errors } = await launch(userData, volumes);
  const { id } = (await call(win, "importCard", path.join(volumes, "CARD1", "DCIM"))) as { id: string };
  let scan: { ready: boolean; files: { n: number }[] } | null = null;
  await expect.poll(async () => (scan = (await call(win, "importScan", id)) as typeof scan)?.ready, { timeout: 60_000 }).toBe(true);
  const { job } = (await call(win, "importStart", { scanId: id, events: [{ title: "Sports day", date: "2026-10-12", className: null, files: scan!.files.map((f) => f.n) }] })) as { job: number };
  await expect.poll(async () => ((await call(win, "importJobs")) as { id: number; state: string }[]).find((x) => x.id === job)?.state, { timeout: 60_000 }).toBe("done");
  await settled(win, dbFile, 4);
  const event = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day");
  expect(existsSync(path.join(event, "RAW", "IMG_0100.CR2"))).toBe(true);

  // B-58: a RAW in the "RAW" folder whose JPEG was read first was a second
  // photo. Now: a JPEG read first, then its RAW.
  const later = path.join(lib, "2026-2027", "Term 1", "2026-10-13 Class trip");
  const k = await photo(40);
  put(path.join(later, "IMG_0200.JPG"), k);
  await settled(win, dbFile, 5);
  put(path.join(later, "RAW", "IMG_0200.CR2"), rawFile(k));
  await settled(win, dbFile, 6);

  let all = rows(dbFile);
  const pairs = all.filter((r) => r.pair_of != null);
  expect(pairs.map((r) => path.basename(r.path)).sort()).toEqual(["IMG_0100.CR2", "IMG_0101.CR2", "IMG_0200.CR2"]);
  for (const r of pairs) expect(path.basename(byId(all, r.pair_of!).path, ".JPG")).toBe(path.basename(r.path, ".CR2"));
  expect(shown(all).length, "3 photos, not 6").toBe(3);
  const albums = (await call(win, "albums")) as { counts: { all: number } };
  expect(albums.counts.all).toBe(3);

  // Moving the JPEG moves its RAW, into the new event's RAW folder.
  const jpeg = byName(all, "Sports day/IMG_0100.JPG");
  await call(win, "moveTo", [jpeg.id], { title: "Book week", date: "2026-10-20" });
  const moved = path.join(lib, "2026-2027", "Term 1", "2026-10-20 Book week");
  expect(existsSync(path.join(moved, "IMG_0100.JPG"))).toBe(true);
  expect(existsSync(path.join(moved, "RAW", "IMG_0100.CR2")), "the RAW went with it").toBe(true);
  expect(existsSync(path.join(event, "RAW", "IMG_0100.CR2"))).toBe(false);
  // Undo puts both back.
  await call(win, "undo");
  await expect.poll(() => existsSync(path.join(event, "IMG_0100.JPG")) && existsSync(path.join(event, "RAW", "IMG_0100.CR2"))).toBe(true);

  // Binning the photo bins both files; Undo brings both back as one photo.
  await call(win, "bin", [jpeg.id]);
  expect(existsSync(path.join(event, "IMG_0100.JPG"))).toBe(false);
  expect(existsSync(path.join(event, "RAW", "IMG_0100.CR2")), "the RAW went to the Bin too").toBe(false);
  expect(shown(rows(dbFile)).length).toBe(2);
  await call(win, "undo");
  await expect.poll(() => existsSync(path.join(event, "IMG_0100.JPG")) && existsSync(path.join(event, "RAW", "IMG_0100.CR2"))).toBe(true);
  all = rows(dbFile);
  expect(shown(all).length).toBe(3);
  expect(byName(all, "RAW/IMG_0100.CR2").pair_of).toBe(jpeg.id);

  // A JPEG with its RAW is never offered by Clean up, even with an exact copy elsewhere.
  put(path.join(base, "x.jpg"), j[1]);
  put(path.join(lib, "2026-2027", "Term 1", "2026-10-21 Assembly", "IMG_0101.JPG"), j[1]);
  await settled(win, dbFile, 7);
  const exact = (await call(win, "cleanupList", "exact")) as { groups: { keep: number; extra: number[] }[] };
  const pairedJpeg = byName(rows(dbFile), "Sports day/IMG_0101.JPG").id;
  expect(exact.groups.flatMap((g) => g.extra)).not.toContain(pairedJpeg);
  expect(errors).toEqual([]);
  await app.close();
});

const byId = (all: Row[], id: number) => all.find((r) => r.id === id)!;
function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

test("self-filing is off by default; switched on it files photos once, and switched off it stops", async () => {
  test.setTimeout(240_000);
  const { lib, volumes, userData, dbFile } = setup();
  const year = path.join(lib, "2026-2027", "Term 1");
  const at = (file: string, bytes: Buffer, day: string) => {
    put(file, bytes);
    const t = new Date(`${day}T10:00:00`);
    utimesSync(file, t, t);
  };
  const p = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => photo(i + 50)));
  at(path.join(year, "2026-10-01 Assembly", "IMG_0000.jpg"), p[0], "2026-10-01");
  at(path.join(lib, "2026-10-12 Sports day", "IMG_0001.jpg"), p[1], "2026-10-12");
  at(path.join(lib, "2026-10-12 Sports day", "IMG_0002.jpg"), p[2], "2026-10-12");
  at(path.join(lib, "2026-10-12 Sports day", "RAW", "IMG_0001.CR2"), rawFile(p[1]), "2026-10-12");
  at(path.join(lib, "Trip", "IMG_0003.jpg"), p[3], "2026-10-15");
  const { app, win, errors } = await launch(userData, volumes, { HUB_FILE_WAIT: "3000" });
  await settled(win, dbFile, 5);

  // Off by default: nothing moves.
  expect(((await call(win, "state")) as { selfFiling: boolean }).selfFiling).toBe(false);
  await new Promise((r) => setTimeout(r, 5000));
  expect(existsSync(path.join(lib, "Trip", "IMG_0003.jpg"))).toBe(true);

  // Switched on, "Tidy now": each photo moved once into Year / Term / Event,
  // the RAW with its JPEG.
  await call(win, "set", "selfFiling", true);
  const plan = (await call(win, "filingPlan")) as { count: number };
  expect(plan.count, "3 photos (the RAW goes with its JPEG)").toBe(3);
  const done = (await call(win, "applyFiling")) as { moved: number };
  expect(done.moved).toBe(4);
  const sports = path.join(year, "2026-10-12 Sports day");
  for (const f of [path.join(sports, "IMG_0001.jpg"), path.join(sports, "IMG_0002.jpg"), path.join(sports, "RAW", "IMG_0001.CR2"), path.join(year, "2026-10-15 Trip", "IMG_0003.jpg")]) expect(existsSync(f), f).toBe(true);
  expect(existsSync(path.join(lib, "Trip", "IMG_0003.jpg"))).toBe(false);
  const check = () => {
    const all = rows(dbFile).filter((r) => !r.missing);
    expect(new Set(all.map((r) => r.path)).size, "no photo listed twice").toBe(all.length);
    expect(new Set(all.map((r) => r.hash)).size, "no photo doubled").toBe(all.length);
    return all;
  };
  expect(check().length).toBe(5);
  expect(((await call(win, "applyFiling")) as { moved: number }).moved, "nothing moved twice").toBe(0);

  // A new photo outside the event folders is filed by itself.
  at(path.join(lib, "New", "IMG_0004.jpg"), p[4], "2026-10-16");
  await expect.poll(() => existsSync(path.join(year, "2026-10-16 New", "IMG_0004.jpg")), { timeout: 60_000 }).toBe(true);
  expect(check().length).toBe(6);

  // B-60: switched off while a new photo waits to be filed: it stays put.
  at(path.join(lib, "Later", "IMG_0005.jpg"), p[5], "2026-10-17");
  await expect.poll(() => rows(dbFile).find((r) => r.path.endsWith(path.join("Later", "IMG_0005.jpg")))?.hash ?? null, { timeout: 60_000, intervals: [100] }).not.toBeNull();
  await call(win, "set", "selfFiling", false);
  // Longer than the app's usual 20 second wait, not just the test's 3.
  await new Promise((r) => setTimeout(r, 22_000));
  expect(existsSync(path.join(lib, "Later", "IMG_0005.jpg")), "not moved after switching off").toBe(true);

  // B-61: "Ask me first" asks, and moves only when told to.
  await call(win, "set", "selfFiling", true);
  await call(win, "set", "fileAsk", true);
  at(path.join(lib, "Ask", "IMG_0006.jpg"), p[6], "2026-10-18");
  const toast = win.locator(".t", { hasText: "1 new photo isn't in an event folder yet" });
  await expect(toast).toBeVisible({ timeout: 60_000 });
  expect(existsSync(path.join(lib, "Ask", "IMG_0006.jpg")), "asked, not moved").toBe(true);
  await win.screenshot({ path: test.info().outputPath("filing-ask.png") });
  await toast.locator("button").click();
  await expect.poll(() => existsSync(path.join(year, "2026-10-18 Ask", "IMG_0006.jpg")), { timeout: 30_000 }).toBe(true);
  expect(existsSync(path.join(lib, "Later", "IMG_0005.jpg")), "the one from while it was off stays").toBe(true);
  expect(check().length).toBe(8);
  expect(errors).toEqual([]);
  await app.close();
});

test("storage numbers match the disk, and the backup copy fills itself in and can put photos back", async () => {
  test.setTimeout(240_000);
  const { base, lib, volumes, userData, dbFile } = setup();
  const backup = path.join(base, "Backup drive");
  mkdirSync(backup);
  const settingsFile = path.join(userData, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(readFileSync(settingsFile, "utf8")), backup }));
  const event = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day");
  const p = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => photo(i + 70)));
  p.slice(0, 6).forEach((b, i) => put(path.join(event, `IMG_000${i}.jpg`), b));
  const { app, win, errors } = await launch(userData, volumes);
  await settled(win, dbFile, 6);
  type Health = { connected: boolean; total: number; copied: number; canPutBack: number };
  const health = async () => (await call(win, "backupHealth")) as Health;
  // Each new photo gets its copy on the backup drive as it's read.
  await expect.poll(async () => (await health()).copied, { timeout: 30_000 }).toBe(6);
  const inBackup = () => walk(backup).filter((f) => f.endsWith(".jpg"));
  expect(inBackup().length).toBe(6);
  for (const f of inBackup()) expect(sha(readFileSync(f))).toBe(sha(readFileSync(path.join(lib, path.relative(backup, f)))));

  // The Storage page's numbers are the disk's own.
  await win.evaluate(() => (window as unknown as { go: (v: string, p: object) => void }).go("settings", { page: "storage" }));
  const fs = statfsSync(lib);
  const st = (await call(win, "state")) as { disk: { free: number; total: number } };
  expect(st.disk.total).toBe(fs.blocks * fs.bsize);
  expect(Math.abs(st.disk.free - fs.bavail * fs.bsize) / st.disk.total).toBeLessThan(0.01);
  await expect(win.locator("[data-backup-copied]")).toHaveAttribute("data-backup-copied", "6");
  await expect(win.locator("[data-backup-copied]")).toContainText("All 6 photos have a copy on the backup drive");

  // The backup drive away while a photo comes in: it's copied once the
  // drive is back ("Copy the rest now", or by itself later).
  const away = path.join(base, "Backup away");
  renameSync(backup, away);
  put(path.join(event, "IMG_0006.jpg"), p[6]);
  await settled(win, dbFile, 7);
  renameSync(away, backup);
  rmSync(path.join(backup, path.relative(lib, path.join(event, "IMG_0001.jpg")))); // and one copy lost
  await win.evaluate(() => (window as unknown as { go: (v: string, p: object) => void }).go("settings", { page: "storage" }));
  await expect(win.locator("[data-backup-copied]")).toHaveAttribute("data-backup-copied", "5");
  await expect(win.locator("[data-backup-copied]")).toContainText("5 of 7 photos have a copy");
  await win.screenshot({ path: test.info().outputPath("backup-health.png") });
  await win.locator('[data-act="backupNow"]').click();
  await expect(win.locator("[data-backup-copied]")).toHaveAttribute("data-backup-copied", "7", { timeout: 30_000 });
  expect(inBackup().length).toBe(7);

  // Two originals deleted from the library: put back from the backup, the
  // same photos (same record, so names and picks stay).
  const before = rows(dbFile);
  rmSync(path.join(event, "IMG_0002.jpg"));
  rmSync(path.join(event, "IMG_0003.jpg"));
  await expect.poll(async () => (await health()).canPutBack, { timeout: 30_000 }).toBe(2);
  await win.evaluate(() => (window as unknown as { go: (v: string, p: object) => void }).go("settings", { page: "storage" }));
  await win.locator('[data-act="putBack"]').click();
  await expect.poll(() => existsSync(path.join(event, "IMG_0002.jpg")) && existsSync(path.join(event, "IMG_0003.jpg")), { timeout: 30_000 }).toBe(true);
  expect(sha(readFileSync(path.join(event, "IMG_0002.jpg")))).toBe(sha(p[2]));
  await expect.poll(() => rows(dbFile).filter((r) => !r.missing).length, { timeout: 30_000 }).toBe(7);
  const after = rows(dbFile);
  for (const name of ["IMG_0002.jpg", "IMG_0003.jpg"]) expect(byName(after, `Sports day/${name}`).id).toBe(byName(before, `Sports day/${name}`).id);
  expect(errors).toEqual([]);
  await app.close();
});
