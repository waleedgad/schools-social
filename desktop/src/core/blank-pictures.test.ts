import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { bookHtml, type Page } from "./books";
import { openDb } from "./db";
import { Engine } from "./engine";

// Other places where a picture could silently come back blank, blurred or
// as another photo (found after B-96). Each test fails on the code before
// its fix.

async function plain(file: string, colour: { r: number; g: number; b: number }) {
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: colour } }).jpeg().toFile(file);
}
const RED = { r: 220, g: 0, b: 0 }, BLUE = { r: 0, g: 0, b: 220 };

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-blank-"));
  mkdirSync(path.join(dir, "Photos"));
  const db = openDb(path.join(dir, "library.db"));
  const engine = new Engine({ db, library: path.join(dir, "Photos"), cache: path.join(dir, "cache"), models: dir, faces: () => false, paused: () => false, onChange: () => {} });
  const look = async (file: string) => {
    const data = await sharp(file).resize(1, 1).raw().toBuffer();
    const m = await sharp(file).metadata();
    return { red: data[0] > 150 && data[2] < 90, blue: data[2] > 150 && data[0] < 90, width: m.width };
  };
  return { dir, db, engine, look };
}

test("after Clean up removes the big copies, a big photo is still made big", async () => {
  const { dir, db, engine, look } = setup();
  const file = path.join(dir, "Photos", "class.jpg");
  await plain(file, RED);
  const id = Number(db.prepare("insert into photos (path, name, ext, size, mtime, added_at, width, height, thumb, faces_scanned) values (?, 'class.jpg', '.jpg', 1, 1, 1, 3000, 2000, 1, 1)").run(file).lastInsertRowid);
  await engine.thumb(id);
  // What "Clean up" and "Clear the big copies" do while the app is open.
  rmSync(path.join(dir, "cache", "previews"), { recursive: true, force: true });
  // Before: the folder was gone, so the small copy (420 px) came back, blurred, with no word said.
  const shown = await engine.preview(id);
  assert.equal(shown, engine.previewPath(id));
  assert.equal((await look(shown)).width, 2048);
  // And a face is cut from the big copy, not from the small one.
  const face = Number(db.prepare("insert into faces (photo_id, x, y, w, h, score, status) values (?, 0.2, 0.45, 0.04, 0.06, 0.9, 'suggested')").run(id).lastInsertRowid);
  rmSync(path.join(dir, "cache", "previews"), { recursive: true, force: true });
  assert.doesNotMatch(await engine.faceCrop(face), /-small\.jpg$/);
});

test("a new photo never shows the big copy of an old photo that had its number", async () => {
  const { dir, db, engine, look } = setup();
  const old = path.join(dir, "Photos", "old.jpg"), fresh = path.join(dir, "Photos", "new.jpg");
  await plain(old, RED);
  engine.seen(old, statSync(old).size, statSync(old).mtimeMs);
  const first = (db.prepare("select id from photos where path = ?").get(old) as { id: number }).id;
  assert.equal((await look(await engine.preview(first))).red, true);
  await engine.thumb(first);
  // The old photo is binned and the Bin is emptied: the library forgets it.
  rmSync(old);
  db.prepare("delete from photos where id = ?").run(first);
  // The next photo to come in gets the same number.
  await plain(fresh, BLUE);
  engine.seen(fresh, statSync(fresh).size, statSync(fresh).mtimeMs);
  const second = (db.prepare("select id from photos where path = ?").get(fresh) as { id: number }).id;
  assert.equal(second, first);
  // Before: the old (red) photo opened in the big view under the new photo's name.
  assert.equal((await look(await engine.preview(second))).blue, true);
  assert.equal((await look(await engine.thumb(second))).blue, true);
});

test("a person's chosen main face that is gone never leaves a blank circle or shows someone else", async () => {
  const { db } = setup();
  const photo = Number(db.prepare("insert into photos (path, name, ext, size, mtime, added_at, width, height, thumb, faces_scanned) values ('/x/class.jpg', 'class.jpg', '.jpg', 1, 1, 1, 3000, 2000, 1, 1)").run().lastInsertRowid);
  const person = db.prepare("insert into students (id, name_en, class_name, kind, can_post, added_at) values (?, ?, '5A', 'student', 1, 1)");
  person.run("OMAR", "Omar");
  person.run("SARA", "Sara");
  const face = (who: string, x: number) => Number(db.prepare("insert into faces (photo_id, x, y, w, h, score, status, student_id) values (?, ?, 0.4, 0.1, 0.15, 0.9, 'confirmed', ?)").run(photo, x, who).lastInsertRowid);
  const omar = face("OMAR", 0.1), chosen = face("OMAR", 0.5);
  db.prepare("update students set main_face = ? where id = 'OMAR'").run(chosen);
  const page: Page = { id: "p1", type: "class", title: "5A", layout: "auto", photos: [], students: ["OMAR", "SARA"], className: "5A" };
  const faces = () => {
    const html = bookHtml(db, { kind: "class", year: "2026-2027", className: "5A", school: "School", language: "en" }, [page], { photo: (id) => `photo:${id}`, face: (s) => (s.face ? `face:${s.face}` : null), logo: null });
    return [...html.matchAll(/src="face:(\d+)"/g)].map((m) => Number(m[1]));
  };
  assert.deepEqual(faces(), [chosen]); // the chosen face, while it is there
  // The photo is read again: its faces are stored anew under new numbers.
  db.prepare("delete from faces where id = ?").run(chosen);
  // Before: Omar's picture still pointed at the face that is gone (a blank circle on the class page).
  assert.deepEqual(faces(), [omar]);
  // The old number is used again, now for Sara's face.
  const sara = face("SARA", 0.8);
  assert.equal(sara, chosen);
  // Before: Sara's face was printed above Omar's name.
  assert.deepEqual(faces(), [omar, sara]);
});
