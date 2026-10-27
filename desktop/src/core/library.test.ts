import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { openDb } from "./db";
import { importPhotos, listFiles } from "./engine";
import { similarity } from "./faces";
import { placeFromPath } from "./library";
import { fileHash } from "./photo";
import { classFrom, gradeLabel, parseRows } from "./students";

test("class lists from every school system read the same", () => {
  const ours = parseRows([
    ["Student ID", "Name (English)", "Name (Arabic)", "Gender", "Stage", "Grade", "Class", "Portrait file", "Can appear in posts"],
    ["S1", "Salma Ahmed", "سلمى أحمد", "F", "Primary", "Grade 4", "4B", "S1.jpg", "No"],
  ]);
  const ps = parseRows([
    ["Student_Number", "LastFirst", "First_Name", "Last_Name", "Grade_Level", "Home_Room", "Gender"],
    ["1", "Ahmed, Salma", "Salma", "Ahmed", 4, "4B", "F"],
  ]);
  const classera = parseRows([
    ["رقم الطالب", "اسم الطالب", "اسم الطالب بالإنجليزية", "المرحلة", "الصف", "الشعبة", "الجنس"],
    ["S1", "سلمى أحمد", "Salma Ahmed", "ابتدائي", "الصف 4", "B", "أنثى"],
  ]);
  const edu = parseRows([
    ["Admission No", "Student Name", "Student Name (Arabic)", "Grade", "Section", "Gender"],
    ["S1", "Salma Ahmed", "سلمى أحمد", "Grade 4", "B", "Female"],
  ]);
  assert.deepEqual([ours.format, ps.format, classera.format, edu.format], ["hub", "powerschool", "classera", "edunation"]);
  for (const r of [ours, ps, classera, edu]) {
    const s = r.students[0];
    assert.equal(s.id, "S1");
    assert.equal(s.name_en, "Salma Ahmed");
    assert.equal(s.class_name, "4B");
    assert.equal(s.grade, "Grade 4");
    assert.equal(s.stage, "Primary");
    assert.equal(s.gender, "F");
  }
  assert.equal(ours.students[0].can_post, false);
  assert.equal(gradeLabel(-1, "powerschool"), "KG1");
  assert.equal(classFrom("KG2", "A"), "KG2-A");
});

test("year, term, event and class come from the folders", () => {
  const lib = "/lib";
  const p = placeFromPath(lib, "/lib/2026-2027/Term 1/2026-10-20 Science fair/4B/a.jpg");
  assert.deepEqual(p, { year: "2026-2027", term: "Term 1", className: "4B", event: { key: "2026-2027/Term 1/2026-10-20 Science fair", title: "Science fair", date: "2026-10-20" } });
  assert.equal(placeFromPath(lib, "/lib/Old/Sports day/a.jpg").event?.title, "Sports day");
  assert.equal(placeFromPath(lib, "/lib/a.jpg").event, null);
});

test("face alignment maps points exactly when they only moved and scaled", () => {
  const dst = [[38, 51], [73, 51], [56, 71], [41, 92], [70, 92]];
  const src = dst.map(([x, y]) => [x * 2 + 10, y * 2 + 5]);
  const t = similarity(src, dst);
  assert.ok(Math.abs(t.a - 0.5) < 1e-9 && Math.abs(t.b) < 1e-9);
  assert.ok(Math.abs(t.tx + 5) < 1e-9 && Math.abs(t.ty + 2.5) < 1e-9);
});

test("import files photos by event and class and leaves out copies already there", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-lib-"));
  const src = path.join(dir, "card");
  const lib = path.join(dir, "library");
  await mkdir(src, { recursive: true });
  for (const n of [1, 2]) await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: n * 90, g: 0, b: 0 } } }).jpeg().toFile(path.join(src, `IMG_${n}.jpg`));
  const db = openDb(path.join(dir, "db.sqlite"));
  const files = await listFiles(src);
  const first = await importPhotos({ db, library: lib, files, title: "Science fair", date: "2026-10-20", className: "4B", byDay: false, skipDuplicates: true, onProgress: () => {} });
  assert.equal(first.copied, 2);
  assert.ok(first.folders[0].endsWith(path.join("2026-2027", "Term 1", "2026-10-20 Science fair", "4B")));
  // The library already holds the first photo: only the other one is copied again.
  db.prepare("insert into photos (path, name, ext, size, mtime, hash, added_at) values ('x', 'x', '.jpg', 1, 1, ?, 1)").run(await fileHash(files[0]));
  const again = await importPhotos({ db, library: lib, files, title: "Science fair", date: "2026-10-20", className: "4B", byDay: false, skipDuplicates: true, onProgress: () => {} });
  assert.equal(again.duplicates, 1);
  assert.equal(again.copied, 1);
});
