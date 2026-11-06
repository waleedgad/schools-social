import { _electron, expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

async function launch(userData: string, volumes: string) {
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1", HUB_VOLUMES: volumes },
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
  const { rmSync } = await import("node:fs");
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
