import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
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
