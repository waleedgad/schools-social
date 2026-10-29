import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { openDb } from "./db";
import { Engine, importPhotos } from "./engine";
import { assignPhoto, faceProblem, guessTraits, scaled, traitCentres } from "./faces";

const temp = () => mkdtempSync(path.join(tmpdir(), "hub04-"));
const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return Float32Array.from(v.map((x) => x / n));
};

async function photo(file: string, hue: number) {
  await mkdir(path.dirname(file), { recursive: true });
  // A noisy picture, so each one has different bytes and some detail.
  const w = 320, h = 240;
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i += 3) {
    px[i] = (hue * 40 + ((i * 7919) % 97)) & 255;
    px[i + 1] = (i * 31) & 255;
    px[i + 2] = (hue * 90) & 255;
  }
  await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg().toFile(file);
}

async function until(fn: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

function engineFor(dir: string) {
  const db = openDb(path.join(dir, "data", "library.db"));
  const library = path.join(dir, "Photos");
  const engine = new Engine({ db, library, cache: path.join(dir, "cache"), models: path.join(dir, "none"), faces: () => false, paused: () => false, onChange: () => {} });
  return { db, library, engine };
}

test("a photo whose file went missing comes back with its picks when imported again", async () => {
  const dir = temp();
  const card = path.join(dir, "card");
  for (let i = 0; i < 3; i++) await photo(path.join(card, `IMG_${i}.jpg`), i);
  const { db, library, engine } = engineFor(dir);
  await mkdir(library, { recursive: true });
  await engine.start();
  const files = [0, 1, 2].map((i) => path.join(card, `IMG_${i}.jpg`));
  const first = await importPhotos({ db, library, files, title: "Sports day", date: "2020-09-30", className: null, byDay: false, skipDuplicates: true, onProgress: () => {} });
  assert.equal(first.copied, 3);
  await engine.scan();
  await until(() => (db.prepare("select count(*) n from photos where thumb = 1").get() as { n: number }).n === 3);
  const before = db.prepare("select id from photos order by id").all() as { id: number }[];
  db.prepare("update photos set flag = 1, rating = 4").run();

  // The whole library folder is deleted in Finder.
  rmSync(library, { recursive: true, force: true });
  await mkdir(library, { recursive: true });
  await engine.scan();
  assert.equal((db.prepare("select count(*) n from photos where missing = 1").get() as { n: number }).n, 3);

  // Imported again: copied (not "already in library"), and linked back.
  const again = await importPhotos({ db, library, files, title: "Sports day", date: "2020-09-30", className: null, byDay: false, skipDuplicates: true, onProgress: () => {} });
  assert.equal(again.copied, 3);
  assert.equal(again.duplicates, 0);
  await engine.scan();
  await until(() => (db.prepare("select count(*) n from photos where missing = 0 and thumb = 1").get() as { n: number }).n === 3);
  const after = db.prepare("select id, flag, rating from photos where missing = 0 order by id").all() as { id: number; flag: number; rating: number }[];
  assert.deepEqual(after.map((r) => r.id), before.map((r) => r.id));
  assert.ok(after.every((r) => r.flag === 1 && r.rating === 4));
  assert.equal((db.prepare("select count(*) n from photos").get() as { n: number }).n, 3);

  // A third import really does leave them out now.
  const third = await importPhotos({ db, library, files, title: "Sports day", date: "2020-09-30", className: null, byDay: false, skipDuplicates: true, onProgress: () => {} });
  assert.equal(third.duplicates, 3);
  await engine.stop();
});

test("moved photos get a fresh big picture from their new place", async () => {
  const dir = temp();
  const { db, library, engine } = engineFor(dir);
  for (let i = 0; i < 2; i++) await photo(path.join(library, "2020-2021", "Term 1", "2020-09-30 Sports day", `P${i}.jpg`), i + 4);
  await engine.start();
  await until(() => (db.prepare("select count(*) n from photos where thumb = 1").get() as { n: number }).n === 2);
  const ids = (db.prepare("select id from photos order by id").all() as { id: number }[]).map((r) => r.id);
  await engine.preview(ids[0]);
  const undo = await engine.moveTo(ids, { title: "Relay race", date: "2020-09-30", className: "4B" });
  assert.equal(undo.length, 2);
  for (const id of ids) {
    const row = db.prepare("select path, class_name, event_title, year from photos where id = ?").get(id) as { path: string; class_name: string; event_title: string; year: string };
    assert.ok(existsSync(row.path));
    assert.equal(row.class_name, "4B");
    assert.equal(row.event_title, "Relay race");
    assert.equal(row.year, "2020-2021");
    const big = await engine.preview(id);
    assert.ok(existsSync(big));
    const meta = await sharp(big).metadata();
    assert.equal(meta.width, 320);
  }
  // A missing original shows the thumbnail instead of nothing.
  const p = db.prepare("select path from photos where id = ?").get(ids[1]) as { path: string };
  rmSync(p.path);
  await engine.clearCache(ids[1]).catch(() => {});
  await engine.thumb(ids[0]);
  assert.equal(engine.originalThere(ids[1]), false);
  await assert.rejects(engine.preview(ids[1]));
  await engine.stop();
});

test("a person is named at most once in a photo", () => {
  const ahmed = unit([1, 0, 0, 0]);
  const sara = unit([0, 1, 0, 0]);
  const known = [
    { studentId: "ahmed", embedding: ahmed },
    { studentId: "sara", embedding: sara },
  ];
  // Two faces that both look most like Ahmed: only the closer one gets him.
  const faces = [unit([0.9, 0.2, 0.1, 0]), unit([0.8, 0.5, 0.1, 0]), unit([0, 0, 0, 1])];
  const m = assignPhoto(faces, known);
  assert.equal(m[0]?.studentId, "ahmed");
  assert.equal(m[1]?.studentId, "sara");
  assert.equal(m[2], null);
  // Someone already named in the photo is never suggested again there.
  const n = assignPhoto(faces.slice(0, 1), known, "sface", new Set(["ahmed"]));
  assert.notEqual(n[0]?.studentId, "ahmed");
});

test("hands, side-on and blurred faces are left out", () => {
  const good = { box: [100, 100, 100, 110], score: 0.95, landmarks: [130, 140, 170, 140, 150, 165, 135, 185, 165, 185] };
  assert.equal(faceProblem(good, 80, 2000, 1500), null);
  assert.equal(faceProblem({ ...good, box: [100, 100, 30, 30] }, 80, 2000, 1500), "too-small");
  // Mouth above the eyes: not a face (a hand, a drum).
  assert.equal(faceProblem({ ...good, landmarks: [130, 185, 170, 185, 150, 165, 135, 140, 165, 140] }, 80, 2000, 1500), "not-a-face");
  assert.equal(faceProblem({ ...good, landmarks: [148, 140, 152, 140, 150, 165, 140, 185, 160, 185] }, 80, 2000, 1500), "side-on");
  assert.equal(faceProblem(good, 5, 2000, 1500), "blurred");
});

test("boy or girl, student or adult, learned from the school's own named faces", () => {
  const known = [];
  for (let i = 0; i < 15; i++) {
    known.push({ studentId: `g${i}`, embedding: unit([1, 0.1 * (i % 3), 0, 0.2]), gender: "F", kind: "student" });
    known.push({ studentId: `b${i}`, embedding: unit([0, 0.1 * (i % 3), 1, 0.2]), gender: "M", kind: "student" });
    known.push({ studentId: `t${i}`, embedding: unit([0.4, 0, 0.4, 1]), gender: null, kind: "teacher" });
  }
  const t = traitCentres(known, 4);
  assert.equal(guessTraits(unit([1, 0, 0.1, 0.2]), t).gender, "F");
  assert.equal(guessTraits(unit([0.1, 0, 1, 0.2]), t).gender, "M");
  assert.equal(guessTraits(unit([0.4, 0, 0.4, 1]), t).adult, true);
});

test("AuraFace scores are shown on the same scale", () => {
  assert.equal(scaled(0.5, "sface"), 0.5);
  assert.ok(Math.abs(scaled(0.38, "aura") - 0.5) < 1e-9);
  assert.ok(Math.abs(scaled(0.52, "aura") - 0.62) < 1e-9);
  assert.ok(scaled(0.2, "aura") < 0.363);
});

test("a 0.3 library opens in 0.4 and keeps everything", () => {
  const dir = temp();
  const file = path.join(dir, "library.db");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const old = new DatabaseSync(file);
  old.exec(`create table photos (id integer primary key, path text not null unique, name text not null, ext text not null, size integer not null, mtime integer not null,
    hash text, width integer, height integer, taken_at text, year text, term text, event_key text, event_title text, event_date text, class_name text,
    is_raw integer not null default 0, pair_of integer, edited_of integer, dup_of integer, thumb integer not null default 0, faces_scanned integer not null default 0,
    face_count integer not null default 0, sharpness real, brightness real, quality real, dhash text, rating integer not null default 0, flag integer not null default 0,
    label text, remote_id text, missing integer not null default 0, added_at integer not null);
    create table students (id text primary key, name_en text, name_ar text, gender text, stage text, grade text, class_name text, can_post integer not null default 1, portrait text, remote_id text, added_at integer not null, main_face integer);
    create table faces (id integer primary key, photo_id integer not null, x real not null, y real not null, w real not null, h real not null, score real not null default 1, embedding blob,
      student_id text, status text not null default 'unknown', suggest_id text, suggest_score real, rejected text not null default '', portrait integer not null default 0, auto integer not null default 0);
    insert into photos (path, name, ext, size, mtime, added_at, flag) values ('/x/a.jpg', 'a.jpg', '.jpg', 1, 1, 1, 1);
    insert into students (id, name_en, added_at) values ('S1', 'Youssef', 1);
    insert into faces (photo_id, x, y, w, h, student_id, status) values (1, 0.1, 0.1, 0.2, 0.2, 'S1', 'confirmed');
    insert into faces (photo_id, x, y, w, h, student_id, status, auto) values (1, 0.5, 0.1, 0.2, 0.2, 'S1', 'confirmed', 1);`);
  old.close();
  const db = openDb(file);
  const f = db.prepare("select model, status from faces order by id").all() as { model: string; status: string }[];
  assert.equal(f[0].model, "sface");
  assert.equal((db.prepare("select kind from students").get() as { kind: string }).kind, "student");
  assert.equal((db.prepare("select flag from photos").get() as { flag: number }).flag, 1);
  const engine = new Engine({ db, library: dir, cache: path.join(dir, "cache"), models: dir, faces: () => false, paused: () => false, onChange: () => {} });
  assert.equal(engine.dedupePeople(), 1);
  const left = db.prepare("select status from faces order by id").all() as { status: string }[];
  assert.deepEqual(left.map((r) => r.status), ["confirmed", "unknown"]);
});

import { compareList, isoDate, likelyDuplicates, nextClass, parseRows, schoolYear } from "./students";
import { nameKey } from "./names";

test("class list: birthdays and join dates in any common format", () => {
  assert.equal(isoDate("2015-3-4"), "2015-03-04");
  assert.equal(isoDate("4/3/2015"), "2015-03-04");
  assert.equal(isoDate("42064"), "2015-03-01");
  assert.equal(isoDate(""), null);
  const p = parseRows([["Student ID", "Name English", "Class", "Date of birth"], ["S1", "Ali Hassan", "4B", "04/03/2015"]]);
  assert.equal(p.students[0].birthday, "2015-03-04");
});

test("class list: changes are shown before they're applied", () => {
  const known = [
    { id: "S1", name_en: "Ali", name_ar: null, class_name: "4B", kind: "student", left_on: null },
    { id: "S2", name_en: "Mona", name_ar: null, class_name: "4B", kind: "student", left_on: null },
    { id: "S3", name_en: "Omar", name_ar: null, class_name: "5A", kind: "student", left_on: null },
    { id: "S4", name_en: "Hana", name_ar: null, class_name: "4A", kind: "student", left_on: "2026-06-30" },
  ];
  const row = (id: string, name: string, cls: string) => ({ id, name_en: name, name_ar: null, gender: null, stage: null, grade: null, class_name: cls, portrait: null, can_post: true });
  const c = compareList(known, [row("S1", "Ali Hassan", "4A"), row("S4", "Hana", "4A"), row("S9", "New One", "4B")]);
  assert.deepEqual(c.added.map((s) => s.id), ["S9"]);
  assert.deepEqual(c.moved.map((s) => s.id), ["S1"]);
  assert.deepEqual(c.renamed.map((s) => s.id), ["S1"]);
  assert.deepEqual(c.left.map((s) => s.id), ["S2"]); // S3's class isn't in this file
  assert.deepEqual(c.back.map((s) => s.id), ["S4"]);
});

test("new school year: everyone moves up a class", () => {
  assert.deepEqual(nextClass("4B", "Grade 4"), { class_name: "5B", grade: "Grade 5", graduates: false });
  assert.deepEqual(nextClass("KG1-A", "KG1"), { class_name: "KG2-A", grade: "KG2", graduates: false });
  assert.deepEqual(nextClass("KG2-A", "KG2"), { class_name: "1A", grade: "Grade 1", graduates: false });
  assert.equal(nextClass("12C", "Grade 12").graduates, true);
  assert.equal(schoolYear(new Date(2026, 9, 1)), "2026-2027");
  assert.equal(schoolYear(new Date(2027, 4, 1)), "2026-2027");
});

test("duplicate students found by spelling", () => {
  const rows = [
    { id: "S1", name_en: "Mohamed Ali Hassan", name_ar: null, class_name: "4B", kind: "student" },
    { id: "X9", name_en: "Muhammad Ali Hasan", name_ar: null, class_name: "4B", kind: "student" },
    { id: "S2", name_en: "Omar Tarek", name_ar: null, class_name: "4B", kind: "student" },
  ];
  const d = likelyDuplicates(rows, nameKey);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].map((r) => r.id).sort(), ["S1", "X9"]);
});

import { exactCopies, oldRejected } from "./cleanup";

test("clean up never offers posted, picked, named or yearbook photos", () => {
  const dir = temp();
  const db = openDb(path.join(dir, "l.db"));
  const add = (id: number, extra: Record<string, unknown> = {}) => {
    const row = { id, path: `/x/${id}.jpg`, name: `${id}.jpg`, ext: ".jpg", size: 100, mtime: 1, added_at: 1, ...extra };
    db.prepare(`insert into photos (${Object.keys(row).join(", ")}) values (${Object.keys(row).map(() => "?").join(", ")})`).run(...(Object.values(row) as never[]));
  };
  add(1);
  add(2, { dup_of: 1 });
  add(3, { dup_of: 1, posts: 2 });
  add(4, { dup_of: 1, flag: 1 });
  add(5, { flag: -1 });
  add(6, { flag: -1 });
  add(7, { flag: -1 });
  db.prepare("insert into students (id, name_en, added_at) values ('S1', 'Ali', 1)").run();
  db.prepare("insert into faces (photo_id, x, y, w, h, student_id, status) values (6, 0, 0, .1, .1, 'S1', 'confirmed')").run();
  db.prepare("insert into books (spec, pages, updated_at) values (?, ?, 1)").run(JSON.stringify({ title: "Book" }), JSON.stringify([{ photos: [7] }]));
  const g = exactCopies(db);
  assert.deepEqual(g[0].extra, [2]);
  assert.deepEqual(oldRejected(db, 0).map((p) => p.id), [5]);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("smart crop keeps the faces in", async () => {
  const { smartCrop } = await import("../features/posts.js");
  // A wide photo with faces on the right: the 4:5 cut moves right.
  const c = smartCrop(1200, 800, 4 / 5, [{ x: 0.7, y: 0.3, w: 0.1, h: 0.15 }, { x: 0.82, y: 0.32, w: 0.1, h: 0.15 }]);
  assert.equal(c.height, 800);
  assert.equal(c.width, 640);
  assert.ok(c.left <= 0.7 * 1200 && c.left + c.width >= 0.92 * 1200);
  // No faces: the middle.
  assert.equal(smartCrop(1200, 800, 1, []).left, 200);
  // A tall photo cut to square keeps the face row.
  const t = smartCrop(800, 1200, 1, [{ x: 0.4, y: 0.6, w: 0.2, h: 0.12 }]);
  assert.ok(t.top <= 0.6 * 1200 && t.top + t.height >= 0.72 * 1200);
});
