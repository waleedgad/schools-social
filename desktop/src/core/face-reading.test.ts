import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { openDb } from "./db";
import { Engine } from "./engine";
import { assignPhoto, cosine, cut, findFaces, isSure, shrinkForAlign, similarity } from "./faces";

// 0.12: faces are read better (Waleed, 11 Nov 2026: about 95% named by
// themselves). Small faces in a big photo come from the original photo, each
// face gets a closer second look, big faces are shrunk smoothly, and "one
// person per photo" sharpens each match's lead.
const MODELS = path.resolve(__dirname, "../../models");
const FACE = path.resolve(__dirname, "../../e2e/fixtures/face/astronaut.jpg");
const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return Float32Array.from(v, (x) => x / n);
};

// A camera-sized class photo: the same face six times, 160 px wide in the
// photo itself and only 53 px on the 2000 px copy.
async function classPhoto() {
  const tile = await sharp(FACE).resize(900, 900).toBuffer();
  return sharp({ create: { width: 6000, height: 4000, channels: 3, background: "#778899" } })
    .composite([0, 1, 2, 3, 4, 5].map((i) => ({ input: tile, left: 200 + i * 950, top: 500 + (i % 2) * 1200 })))
    .jpeg({ quality: 92 })
    .toBuffer();
}

test("a small face in a big photo is read from the original", async () => {
  const [portrait] = await findFaces(MODELS, FACE);
  assert.ok(portrait?.usable);
  const big = await classPhoto();
  const now = await findFaces(MODELS, big);
  const before = await findFaces(MODELS, big, { legacy: true });
  assert.equal(now.length, 6);
  assert.equal(before.length, 6);
  for (const f of now) {
    assert.ok(f.usable, f.why ?? "");
    assert.ok(f.px! > 140 && f.px! < 180, `width ${f.px}`); // the photo's own pixels
    assert.ok(f.zoomScore! > 0.86, `second look ${f.zoomScore}`);
    // eyes, nose and mouth come back in the 2000 px copy's pixels, inside the box
    assert.ok(f.landmarks[0] > f.box[0] * 2000 && f.landmarks[0] < (f.box[0] + f.box[2]) * 2000);
  }
  const like = (list: typeof now) => list.reduce((s, f) => s + cosine(f.embedding, portrait.embedding), 0) / list.length;
  // The same person's portrait is a closer match than the 0.11 way gave.
  assert.ok(like(now) > 0.95, `now ${like(now)}`);
  assert.ok(like(now) > like(before) + 0.02, `now ${like(now)} before ${like(before)}`);
});

test("a black-and-white photo and a very big face are read too", async () => {
  const [portrait] = await findFaces(MODELS, FACE);
  const [grey] = await findFaces(MODELS, await sharp(FACE).greyscale().jpeg().toBuffer());
  assert.ok(grey?.usable);
  const [huge] = await findFaces(MODELS, await sharp(FACE).resize(1900, 1900).jpeg().toBuffer(), { variants: ["v1", "aa"] });
  assert.ok(huge?.usable);
  assert.ok(cosine(huge.embedding, portrait.embedding) > 0.95);
  assert.equal(huge.variants?.v1.length, huge.embedding.length);
});

test("a big face is made smaller before it is cut out", async () => {
  const W = 1400;
  const data = Buffer.alloc(W * W * 3, 90);
  // where a 700 px wide face has its eyes, nose and mouth
  const ref = [38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041];
  const lm = ref.map((v) => v * 7 + 300);
  const out = await shrinkForAlign({ data, width: W, height: W }, lm);
  assert.ok(out.width < 200 && out.width > 110, `width ${out.width}`);
  const pts = (l: number[]) => [0, 1, 2, 3, 4].map((i) => [l[i * 2], l[i * 2 + 1]]);
  const s = similarity(pts(out.landmarks), pts(ref));
  assert.ok(Math.abs(Math.hypot(s.a, s.b) - 0.9) < 0.03, `scale ${Math.hypot(s.a, s.b)}`);
  assert.equal(out.data[0], 90);
  // a face that is already small is left alone
  const small = await shrinkForAlign({ data, width: W, height: W }, ref.map((v) => v * 1.2 + 300));
  assert.equal(small.width, W);
  // cutting past the edge gives black, not a crash
  const c = cut({ data, width: W, height: W }, -10, -10, 20, 20);
  assert.equal(c[0], 0);
  assert.equal(c[(10 * 20 + 10) * 3], 90);
});

test("one person per photo sharpens the lead", () => {
  const known = [
    { studentId: "ahmed", embedding: unit([1, 0, 0, 0]) },
    { studentId: "sara", embedding: unit([0, 1, 0, 0]) },
    { studentId: "omar", embedding: unit([0, 0, 1, 0]) },
  ];
  // Face 0 is surely Ahmed. Face 1 looks like Sara, with Ahmed close behind.
  const faces = [unit([1, 0, 0, 0]), unit([0.66, 0.72, 0.2, 0])];
  const plain = assignPhoto(faces, known, "sface", new Set(), undefined, { plain: true });
  assert.equal(plain[1]?.studentId, "sara");
  assert.equal(isSure(plain[1]), false);
  // Ahmed is already in the photo for sure: Sara's lead is over Omar now.
  const now = assignPhoto(faces, known);
  assert.equal(now[1]?.studentId, "sara");
  assert.ok(now[1]!.runnerUp < 0.25);
  assert.equal(isSure(now[1]), true);
  // The same when a person named Ahmed in this photo by hand.
  const hand = assignPhoto(faces.slice(1), known, "sface", new Set(["ahmed"]));
  assert.equal(isSure(hand[0]), true);
  // Twins and look-alikes are never ruled out.
  const twins = assignPhoto(faces, known, "sface", new Set(), undefined, { careful: (id) => id === "ahmed" });
  assert.equal(isSure(twins[1]), false);
  // Face 0 only probably Ahmed: nobody is ruled out.
  const unsure = assignPhoto([unit([0.75, 0.66, 0, 0]), faces[1]], known);
  assert.equal(isSure(unsure[1]), false);
});

test("an old library: big photos with small faces are read again once", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-read-"));
  const db = openDb(path.join(dir, "library.db"));
  db.exec(`insert into photos (id, path, name, ext, size, mtime, added_at, width, height, thumb, faces_scanned) values
      (1, '/x/class.jpg', 'class.jpg', '.jpg', 1, 1, 1, 6000, 4000, 1, 1),
      (2, '/x/close.jpg', 'close.jpg', '.jpg', 1, 1, 1, 6000, 4000, 1, 1),
      (3, '/x/phone.jpg', 'phone.jpg', '.jpg', 1, 1, 1, 1600, 1200, 1, 1),
      (4, '/x/new.jpg', 'new.jpg', '.jpg', 1, 1, 1, 6000, 4000, 1, 1);
    insert into faces (photo_id, x, y, w, h, status, read) values
      (1, 0.1, 0.1, 0.03, 0.045, 'unknown', 1),
      (2, 0.1, 0.1, 0.2, 0.3, 'unknown', 1),
      (3, 0.1, 0.1, 0.03, 0.045, 'unknown', 1),
      (4, 0.1, 0.1, 0.03, 0.045, 'unknown', 2);`);
  const engine = new Engine({ db, library: dir, cache: path.join(dir, "cache"), models: dir, faces: () => false, paused: () => false, onChange: () => {} });
  assert.equal(engine.upgradeReading(), 1);
  const rows = db.prepare("select id, faces_scanned from photos order by id").all() as { id: number; faces_scanned: number }[];
  assert.deepEqual(rows.map((r) => r.faces_scanned), [0, 1, 1, 1]);
});
