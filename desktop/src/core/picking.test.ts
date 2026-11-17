import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { openDb } from "./db";
import { Engine, eyesProblem, photoLook, pickBest, type Candidate } from "./engine";
import { eyesShut, findFaces } from "./faces";

// Picking the best photos (Waleed: the biggest time sink is curating and
// editing photos): nobody blinking, sharp where it matters, no two photos
// that look the same, as many students as possible, the whole event.
const MODELS = path.resolve(__dirname, "../../models");
const FACE = path.resolve(__dirname, "../../e2e/fixtures/face/astronaut.jpg");

// The test portrait with both eyes painted shut: skin over each eye and a
// lid line, softened, where the face finder puts the eyes.
async function shutEyes() {
  const meta = await sharp(FACE).metadata();
  const [f] = await findFaces(MODELS, FACE, { eyes: false });
  const l = f.landmarks;
  const ed = Math.hypot(l[2] - l[0], l[3] - l[1]);
  const { data, info } = await sharp(FACE).raw().toBuffer({ resolveWithObject: true });
  const cx = Math.round((l[0] + l[6]) / 2), cy = Math.round((l[1] + l[7]) / 2);
  const i = (cy * info.width + cx) * info.channels;
  const skin = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
  const w = ed * 0.45, h = ed * 0.22;
  const eye = (x: number, y: number) =>
    `<ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${h / 2}" fill="${skin}"/><path d="M${x - w / 2.3} ${y} Q${x} ${y + h * 0.35} ${x + w / 2.3} ${y}" stroke="#3a2a22" stroke-width="${Math.max(2, ed * 0.025)}" fill="none"/>`;
  const svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg"><filter id="b"><feGaussianBlur stdDeviation="${ed * 0.02}"/></filter><g filter="url(#b)">${eye(l[0], l[1])}${eye(l[2], l[3])}</g></svg>`;
  return sharp(FACE).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 92 }).toBuffer();
}

test("open and shut eyes are told apart", async () => {
  const [open] = await findFaces(MODELS, FACE);
  assert.ok(open.eyes, "eyes read on a clear face");
  assert.equal(eyesShut(open.eyes), false);
  const [shut] = await findFaces(MODELS, await shutEyes());
  assert.ok(shut.usable && shut.eyes);
  assert.equal(eyesShut(shut.eyes), true, `blink ${shut.eyes!.blink} opening ${shut.eyes!.ear}`);
  // a face turned well away, or no face at all, is not judged
  assert.equal(eyesShut({ blink: 0.9, ear: 0.1, turn: 0.8 }), false);
  assert.equal(eyesShut({ blink: 0.9, ear: 0.1, turn: 0, presence: 0.2 }), false);
  assert.equal(eyesShut(null), false);
  // the face test only names people: no eyes read
  const [quick] = await findFaces(MODELS, FACE, { eyes: false });
  assert.equal(quick.eyes, null);
});

test("eyes closed: the main person, or a quarter of the group", () => {
  const e = (w: number, shut: boolean, judged = true) => ({ w, shut, judged });
  assert.equal(eyesProblem([e(0.2, true)]), true); // a portrait
  assert.equal(eyesProblem([e(0.2, false)]), false);
  assert.equal(eyesProblem([e(0.03, true), e(0.03, false)]), true); // two small faces, one blinks
  const group = Array.from({ length: 12 }, (_, i) => e(0.04, i === 0));
  assert.equal(eyesProblem(group), false); // one blink in twelve
  assert.equal(eyesProblem(group.map((g, i) => ({ ...g, shut: i < 3 }))), true); // three in twelve
  assert.equal(eyesProblem([e(0.04, false), e(0.04, true, false)]), false); // not judged
});

test("a portrait with a soft background is not blurry; shut eyes cost points", () => {
  const lm = [40, 50, 60, 50, 50, 60, 42, 70, 58, 70];
  const open = { blink: 0.05, ear: 0.3, turn: 0 }, shut = { blink: 0.8, ear: 0.1, turn: 0 };
  // the photo overall measures soft (background blur), the face is crisp
  const soft = photoLook(18, 0.5, [{ box: [0.3, 0.2, 0.25, 0.3], sharpness: 600, landmarks: lm, eyes: open }]);
  assert.ok(!(soft.problems ?? "").includes("blurry"), soft.problems ?? "");
  // a tiny face doesn't rescue a blurry photo
  const tiny = photoLook(18, 0.5, [{ box: [0.3, 0.2, 0.02, 0.03], sharpness: 600, landmarks: lm, eyes: null }]);
  assert.match(tiny.problems ?? "", /blurry/);
  const blink = photoLook(800, 0.5, [{ box: [0.3, 0.2, 0.25, 0.3], sharpness: 600, landmarks: lm, eyes: shut }]);
  const fine = photoLook(800, 0.5, [{ box: [0.3, 0.2, 0.25, 0.3], sharpness: 600, landmarks: lm, eyes: open }]);
  assert.match(blink.problems ?? "", /eyes-closed/);
  assert.equal(fine.problems, null);
  assert.ok(fine.quality - blink.quality >= 2.5);
});

const row = (id: number, quality: number, more: Partial<Candidate> = {}): Candidate => ({ id, quality, flag: 0, rating: 0, problems: null, dhash: null, at: null, ...more });

test("best photos: no blinks or blur while good ones are left", () => {
  const rows = [row(1, 9, { problems: "eyes-closed" }), row(2, 9, { problems: "blurry" }), row(3, 6), row(4, 5.5), row(5, 5)];
  assert.deepEqual(pickBest(rows, 3).sort(), [3, 4, 5]);
  // not enough good ones: the best of the rest fill in
  assert.equal(pickBest(rows, 5).length, 5);
  // a green flag is the school's choice and stays
  assert.ok(pickBest([row(1, 9, { problems: "blurry", flag: 1 }), row(3, 6), row(4, 5)], 2).includes(1));
});

test("best photos: never two that look the same, even with no camera time", () => {
  const rows = [row(1, 9, { dhash: "ffff0000ffff0000" }), row(2, 8.9, { dhash: "ffff0000ffff0001" }), row(3, 7, { dhash: "0f0f0f0f0f0f0f0f" })];
  assert.deepEqual(pickBest(rows, 2), [1, 3]);
});

test("best photos: more students, and the whole event", () => {
  const people = new Map([
    [1, ["A", "B"]],
    [2, ["A", "B"]],
    [3, ["C", "D"]],
  ]);
  assert.deepEqual(pickBest([row(1, 8), row(2, 7.9), row(3, 7.5)], 2, { people }), [1, 3]);
  // three shots of one minute and one an hour later: the later one comes second
  const at = (m: number) => `2026-11-10T09:${String(m).padStart(2, "0")}:00`;
  const rows = [row(1, 8, { at: at(0) }), row(2, 7.9, { at: `2026-11-10T09:00:20` }), row(3, 7.8, { at: `2026-11-10T09:00:40` }), row(4, 7.2, { at: at(59) })];
  assert.deepEqual(pickBest(rows, 2), [1, 4]);
});

test("photos scanned before 0.12 get their eyes read in the background", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-eyes-"));
  try {
    const file = path.join(dir, "shut.jpg"), open = path.join(dir, "open.jpg");
    await sharp(await shutEyes()).toFile(file);
    copyFileSync(FACE, open);
    const [f] = await findFaces(MODELS, FACE, { eyes: false });
    const db = openDb(path.join(dir, "library.db"));
    const add = db.prepare("insert into photos (id, path, name, ext, size, mtime, added_at, width, height, faces_scanned, face_count, quality, problems) values (?, ?, ?, '.jpg', 1, 1, 1, 512, 512, 1, 1, 7, ?)");
    add.run(1, file, "shut.jpg", "head-cut");
    add.run(2, open, "open.jpg", null);
    const face = db.prepare("insert into faces (photo_id, x, y, w, h, status) values (?, ?, ?, ?, ?, 'unknown')");
    face.run(1, ...f.box);
    face.run(2, ...f.box);
    const engine = new Engine({ db, library: dir, cache: path.join(dir, "cache"), models: MODELS, faces: () => true, paused: () => false, onChange: () => {} });
    assert.equal(engine.queueEyes(), 2);
    await engine.eyes(1);
    await engine.eyes(2);
    const rows = db.prepare("select id, eyes_read, quality, problems from photos order by id").all() as { id: number; eyes_read: number; quality: number; problems: string | null }[];
    assert.deepEqual(rows.map((r) => [r.eyes_read, r.problems]), [[1, "head-cut,eyes-closed"], [1, null]]);
    assert.ok(rows[0].quality < 7 && rows[1].quality === 7);
    const blinks = db.prepare("select blink from faces order by photo_id").all() as { blink: number }[];
    assert.ok(blinks.every((b) => typeof b.blink === "number"));
    assert.equal(engine.queueEyes(), 0); // once is enough
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("smart crop: room above heads, no face cut through", async () => {
  const { smartCrop } = await import("../features/posts.js");
  const inside = (c: { left: number; top: number; width: number; height: number }, f: { x: number; y: number; w: number; h: number }, W: number, H: number) =>
    f.x * W >= c.left && (f.x + f.w) * W <= c.left + c.width && f.y * H >= c.top && (f.y + f.h) * H <= c.top + c.height;
  const cut = (c: { left: number; width: number }, f: { x: number; w: number }, W: number) => {
    const a = f.x * W, b = (f.x + f.w) * W;
    return b > c.left && a < c.left + c.width && !(a >= c.left && b <= c.left + c.width);
  };
  // A face near the top of a tall photo cut to 4:5... to 16:9 strip: its hair stays in.
  const tall = smartCrop(1000, 2000, 1, [{ x: 0.4, y: 0.2, w: 0.2, h: 0.1 }]);
  assert.ok(tall.top <= (0.2 - 0.1 * 0.5) * 2000, `top ${tall.top}`);
  // A wide class photo, nine faces in a row, cut to 9:16: whole faces only,
  // and the cut keeps the biggest ones.
  const row = Array.from({ length: 9 }, (_, i) => ({ x: 0.03 + i * 0.105, y: 0.4, w: i === 6 ? 0.09 : 0.07, h: 0.1 }));
  const c = smartCrop(3000, 2000, 9 / 16, row);
  assert.equal(c.width, 1125);
  for (const f of row) assert.ok(!cut(c, f, 3000), `face at ${f.x} cut through (left ${c.left})`);
  assert.ok(inside(c, row[6], 3000, 2000));
  // Two faces far apart: one whole face, not half of each.
  const two = smartCrop(3000, 1000, 1, [{ x: 0.05, y: 0.3, w: 0.15, h: 0.4 }, { x: 0.75, y: 0.3, w: 0.2, h: 0.5 }]);
  assert.ok(!cut(two, { x: 0.05, w: 0.15 }, 3000) && !cut(two, { x: 0.75, w: 0.2 }, 3000));
  assert.ok(inside(two, { x: 0.75, y: 0.3, w: 0.2, h: 0.5 }, 3000, 1000), "the bigger face is kept");
  // Faces that fit get some room at the sides.
  const side = smartCrop(2000, 1000, 1, [{ x: 0.8, y: 0.3, w: 0.15, h: 0.3 }]);
  assert.ok(side.left + side.width >= (0.95 + 0.15 * 0.2) * 2000 || side.left + side.width === 2000);
});
