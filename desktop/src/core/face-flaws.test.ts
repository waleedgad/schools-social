import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb, toBlob } from "./db";
import { Engine } from "./engine";
import { visionCanSee } from "./faces";
import { noPostPhoto } from "./privacy";
import { VISION_GIVE_UP, visionFailed } from "./vision";

// Flaws found 11 Nov 2026 in the face code (thread "Find flaws in faces and
// app features"). Each test fails on the code before the fix.

const DIMS = 128; // SFace descriptions (no AuraFace in these tests)
function face(seed: number, noise = 0, noiseSeed = 1) {
  const v = new Float32Array(DIMS);
  v[seed % DIMS] = 1;
  if (noise) for (let i = 0; i < DIMS; i++) v[i] += noise * Math.sin((i + 1) * (noiseSeed + 7) * 1.37);
  let n = 0;
  for (const x of v) n += x * x;
  return v.map((x) => x / Math.sqrt(n));
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-flaws-"));
  const db = openDb(path.join(dir, "library.db"));
  const touched: number[][] = [];
  const engine = new Engine({ db, library: path.join(dir, "Photos"), cache: path.join(dir, "cache"), models: dir, faces: () => false, paused: () => false, onChange: () => {}, onNamed: (ids) => touched.push(ids) });
  let n = 0;
  const photo = (o: { year?: string; className?: string | null; at?: string } = {}) =>
    Number(
      db
        .prepare("insert into photos (path, name, ext, size, mtime, added_at, width, height, year, class_name, taken_at, thumb, faces_scanned) values (?, ?, '.jpg', 1, 1, 1, 2000, 1500, ?, ?, ?, 1, 1)")
        .run(`${dir}/p${++n}.jpg`, `p${n}.jpg`, o.year ?? "2026-2027", o.className ?? null, o.at ?? "2026-10-10T09:00:00.000Z").lastInsertRowid,
    );
  const addFace = (photoId: number, e: Float32Array, o: { status?: string; student?: string | null; suggest?: string | null; score?: number | null; w?: number; why?: string | null; model?: string } = {}) =>
    Number(
      db
        .prepare("insert into faces (photo_id, x, y, w, h, score, embedding, status, student_id, suggest_id, suggest_score, model, why) values (?, 0.1, 0.1, ?, ?, 0.95, ?, ?, ?, ?, ?, ?, ?)")
        .run(photoId, o.w ?? 0.1, (o.w ?? 0.1) * 1.3, toBlob(e), o.status ?? "unknown", o.student ?? null, o.suggest ?? null, o.score ?? null, o.model ?? "sface", o.why ?? null).lastInsertRowid,
    );
  const student = (id: string, className: string | null, o: { canPost?: boolean } = {}) =>
    db.prepare("insert into students (id, name_en, class_name, can_post, added_at) values (?, ?, ?, ?, 1)").run(id, id, className, o.canPost === false ? 0 : 1);
  const get = (id: number) => db.prepare("select * from faces where id = ?").get(id) as Record<string, unknown>;
  return { dir, db, engine, photo, addFace, student, get, touched };
}

// B-80: a class folder from an earlier school year was matched against the
// students in that class NOW. After "Move everyone up a year", last year's
// 4A photos were matched against this year's 4A (other students), so the
// real student was never suggested or named.
test("B-80: last year's class photo is matched against last year's class", () => {
  const { db, engine, photo, addFace, student, get } = setup();
  student("SARA", "5A"); // in 4A last year, moved up
  student("OMAR", "4A"); // in 4A now (was in 3A)
  db.prepare("insert into school_history (student_id, year, class_name) values ('SARA', '2025-2026', '4A'), ('OMAR', '2025-2026', '3A')").run();
  // Named faces from this year
  for (let i = 0; i < 3; i++) addFace(photo({ className: "5A" }), face(1, 0.05, i), { status: "confirmed", student: "SARA" });
  for (let i = 0; i < 3; i++) addFace(photo({ className: "4A" }), face(2, 0.05, i), { status: "confirmed", student: "OMAR" });
  // Sara in last year's 4A folder
  const old = addFace(photo({ year: "2025-2026", className: "4A", at: "2026-03-01T09:00:00.000Z" }), face(1, 0.05, 9));
  engine.rematch();
  assert.equal(get(old).student_id, "SARA", "Sara is named in her class photo from last year");
  // Omar wasn't in 4A last year: a face like his in that folder isn't held back to the class either
});

test("B-80: an earlier year with no school history isn't held to today's classes", () => {
  const { engine, photo, addFace, student, get } = setup();
  student("SARA", "5A");
  student("OMAR", "4A");
  for (let i = 0; i < 3; i++) addFace(photo({ className: "5A" }), face(1, 0.05, i), { status: "confirmed", student: "SARA" });
  for (let i = 0; i < 3; i++) addFace(photo({ className: "4A" }), face(2, 0.05, i), { status: "confirmed", student: "OMAR" });
  const old = addFace(photo({ year: "2025-2026", className: "4A", at: "2026-03-01T09:00:00.000Z" }), face(1, 0.05, 9));
  engine.rematch();
  assert.equal(get(old).student_id, "SARA");
});

test("B-80: this year's class photo still looks at this year's class first", () => {
  const { engine, photo, addFace, student, get } = setup();
  student("SARA", "5A");
  student("OMAR", "4A");
  for (let i = 0; i < 3; i++) addFace(photo({ className: "5A" }), face(1, 0.05, i), { status: "confirmed", student: "SARA" });
  for (let i = 0; i < 3; i++) addFace(photo({ className: "4A" }), face(2, 0.05, i), { status: "confirmed", student: "OMAR" });
  // A Sara look-alike in this year's 4A: Sara isn't in 4A, so she isn't named there
  const f = addFace(photo({ className: "4A" }), face(1, 0.05, 9));
  engine.rematch();
  assert.notEqual(get(f).student_id, "SARA");
});

// B-84: "groups of unnamed faces" compared faces described by different
// recognisers while a library was being described again (after AuraFace
// arrived), so one group could hold different people.
test("B-84: unnamed face groups only compare faces from the same recogniser", () => {
  const { engine, photo, addFace } = setup();
  const a = addFace(photo(), face(3, 0.05, 1));
  const b = addFace(photo(), face(3, 0.05, 2));
  // An old description from another recogniser that happens to start the same way
  const longer = new Float32Array(640);
  longer.set(face(3, 0.05, 3));
  const c = addFace(photo(), longer.map((x) => x * 0.999), { model: "aura" });
  const groups = engine.unknownGroups();
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0]].sort(), [a, b].sort());
  assert.ok(!groups[0].includes(c));
});

// B-81: a photo changed in another app (cropped, rotated, retouched) kept
// its old face boxes and its old big picture.
test("B-81: a changed photo file is looked at again for faces, its big picture made again", () => {
  const { dir, db, engine, photo } = setup();
  mkdirSync(path.join(dir, "Photos"), { recursive: true });
  const id = photo();
  const file = db.prepare("select path from photos where id = ?").get(id) as { path: string };
  db.prepare("update photos set path = ?, size = 10, mtime = 1000 where id = ?").run(path.join(dir, "Photos", "a.jpg"), id);
  mkdirSync(path.dirname(engine.previewPath(id)), { recursive: true });
  writeFileSync(engine.previewPath(id), "old picture");
  engine.seen(path.join(dir, "Photos", "a.jpg"), 12, 2000);
  const p = db.prepare("select faces_scanned, thumb from photos where id = ?").get(id) as { faces_scanned: number; thumb: number };
  assert.equal(p.thumb, 0);
  assert.equal(p.faces_scanned, 0, "faces are looked for again");
  // the old big picture goes (removed in the background)
  return new Promise<void>((resolve) =>
    setTimeout(() => {
      assert.equal(existsSync(engine.previewPath(id)), false);
      assert.ok(file);
      resolve();
    }, 200),
  );
});

// B-85: since far faces and weak matches stopped being shown as
// suggestions, a student who can't appear standing far back (or matched at
// 50-55%) was no longer kept off the website.
test("B-85: a far or weaker likely match with a student who can't appear still counts", () => {
  const { db, photo, addFace, student } = setup();
  student("NO", "5A", { canPost: false });
  student("OK", "5A");
  const far = photo();
  addFace(far, face(5), { status: "unknown", suggest: "NO", score: 0.61, why: "far", w: 0.03 });
  const weak = photo();
  addFace(weak, face(5), { status: "unknown", suggest: "NO", score: 0.52 });
  const guess = photo();
  addFace(guess, face(5), { status: "unknown", suggest: "NO", score: 0.45 });
  const fine = photo();
  addFace(fine, face(5), { status: "unknown", suggest: "OK", score: 0.61, why: "far" });
  const blocked = (db.prepare(`select p.id from photos p where ${noPostPhoto("p")} order by p.id`).all() as { id: number }[]).map((r) => r.id);
  assert.deepEqual(blocked, [far, weak]);
});

test("B-85: when matching changes who a face probably is, the website check hears about it", () => {
  const { engine, photo, addFace, student, touched } = setup();
  student("NO", null, { canPost: false });
  for (let i = 0; i < 2; i++) addFace(photo(), face(6, 0.12, i), { status: "confirmed", student: "NO" });
  const p = photo();
  addFace(p, face(6, 0.12, 5)); // close, but not sure: a suggestion only
  engine.rematch();
  assert.ok(touched.flat().includes(p), "the photo is checked again");
});

// B-86: the Mac's Apple Vision second look ruled out every face it didn't
// see, also small faces at the back of a class photo it can't see; and one
// slow photo switched it off until the app restarted.
test("B-86: only faces big enough for Apple Vision are ruled out when it sees nothing", () => {
  // a 6000 x 4000 photo is read at 2000 px, Vision looks at 1600 px
  assert.equal(visionCanSee([0.1, 0.1, 0.02, 0.03], 2000, 1333), false); // 32 px
  assert.equal(visionCanSee([0.1, 0.1, 0.06, 0.09], 2000, 1333), true); // 96 px
});

test("B-86: one failed look doesn't switch Apple Vision off", () => {
  visionFailed(true);
  for (let i = 1; i < VISION_GIVE_UP; i++) assert.equal(visionFailed(false), i);
  assert.equal(visionFailed(true), 0, "a good look starts the count again");
});
