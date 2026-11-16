import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { openDb } from "./db";
import { Engine } from "./engine";

// B-96: the face beside "Is this …?" was sometimes a blank white square.
// The small face picture could not be made (so the screen got nothing)
// while the whole photo beside it still showed. Each test fails on the code
// before the fix.

// A photo that is red on its left half and blue on its right half.
async function twoHalves(file: string, width = 3000, height = 2000) {
  const half = { create: { width: width / 2, height, channels: 3 as const, background: { r: 0, g: 0, b: 220 } } };
  await sharp({ create: { width, height, channels: 3, background: { r: 220, g: 0, b: 0 } } })
    .composite([{ input: await sharp(half).png().toBuffer(), left: width / 2, top: 0 }])
    .jpeg()
    .toFile(file);
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-crop-"));
  mkdirSync(path.join(dir, "Photos"));
  const db = openDb(path.join(dir, "library.db"));
  const engine = new Engine({ db, library: path.join(dir, "Photos"), cache: path.join(dir, "cache"), models: dir, faces: () => false, paused: () => false, onChange: () => {} });
  const photo = async (name: string) => {
    const file = path.join(dir, "Photos", name);
    await twoHalves(file);
    const id = Number(db.prepare("insert into photos (path, name, ext, size, mtime, added_at, width, height, thumb, faces_scanned) values (?, ?, '.jpg', 1, 1, 1, 3000, 2000, 1, 1)").run(file, name).lastInsertRowid);
    return { id, file };
  };
  const face = (photoId: number, x: number) =>
    Number(db.prepare("insert into faces (photo_id, x, y, w, h, score, status) values (?, ?, 0.45, 0.04, 0.06, 0.9, 'suggested')").run(photoId, x).lastInsertRowid);
  // The colour and size of a face picture.
  const look = async (file: string) => {
    const data = await sharp(file).resize(1, 1).raw().toBuffer();
    const m = await sharp(file).metadata();
    return { red: data[0] > 150 && data[2] < 90, blue: data[2] > 150 && data[0] < 90, width: m.width };
  };
  return { dir, db, engine, photo, face, look };
}

test("B-96: a face still gets its picture when the original can't be reached", async () => {
  const { engine, photo, face, look } = setup();
  const p = await photo("class.jpg");
  await engine.thumb(p.id); // the small copy made when the photo came in
  rmSync(p.file); // the archive drive is unplugged; the big copy was never made
  const left = face(p.id, 0.2), right = face(p.id, 0.7);
  // Before: "Input file is missing", so the screen showed a blank square.
  assert.equal((await look(await engine.faceCrop(left))).red, true);
  assert.equal((await look(await engine.faceCrop(right))).blue, true);
});

test("B-96: the face picture is made sharp again once the original is back", async () => {
  const { engine, photo, face, look } = setup();
  const p = await photo("class.jpg");
  await engine.thumb(p.id);
  const id = face(p.id, 0.2);
  rmSync(p.file);
  const small = await engine.faceCrop(id);
  assert.equal((await look(small)).red, true);
  await twoHalves(p.file); // the drive is plugged in again
  const sharpOne = await engine.faceCrop(id);
  assert.notEqual(sharpOne, small, "not the picture cut from the small copy");
  assert.equal(existsSync(engine.previewPath(p.id)), true, "cut from the big copy");
  assert.equal((await look(sharpOne)).red, true);
});

test("B-96: a face read again never shows another face's old picture", async () => {
  const { db, engine, photo, face, look } = setup();
  const p = await photo("class.jpg");
  const old = face(p.id, 0.2); // on the red half
  assert.equal((await look(await engine.faceCrop(old))).red, true);
  // The photo is read again: its faces are stored anew, and the newest
  // face takes the number the old one had.
  db.prepare("delete from faces where id = ?").run(old);
  const again = face(p.id, 0.7); // on the blue half
  assert.equal(again, old);
  assert.equal((await look(await engine.faceCrop(again))).blue, true);
});

test("B-96: a face at the very edge of the photo still gets a picture", async () => {
  const { db, engine, photo, look } = setup();
  const p = await photo("class.jpg");
  for (const [x, y, w, h] of [[0.985, 0.4, 0.03, 0.05], [0, 0, 0.02, 0.03], [0.99, 0.99, 0.02, 0.03], [0.5, 0.5, 0.0005, 0.0005]]) {
    const id = Number(db.prepare("insert into faces (photo_id, x, y, w, h, score, status) values (?, ?, ?, ?, ?, 0.9, 'suggested')").run(p.id, x, y, w, h).lastInsertRowid);
    assert.equal((await look(await engine.faceCrop(id))).width, 200);
  }
});
