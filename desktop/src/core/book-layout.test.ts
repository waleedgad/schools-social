import assert from "node:assert/strict";
import { test } from "node:test";
import { autoLayout, facesCut } from "./book-layout";

// Yearbook automatic layout: frames fitted to each photo's shape, the best
// photo biggest, faces never cut by a frame, and the same page every time.
const wide = (id: number, score = 0.5, faces: { x: number; y: number; w: number; h: number }[] = []) => ({ id, w: 6000, h: 4000, score, faces });
const tall = (id: number, score = 0.5, faces: { x: number; y: number; w: number; h: number }[] = []) => ({ id, w: 4000, h: 6000, score, faces });
const area = (r: { w: number; h: number }) => r.w * r.h;

test("frames fill the page area without overlapping", () => {
  for (let n = 1; n <= 9; n++) {
    const photos = Array.from({ length: n }, (_, i) => (i % 3 ? wide(i + 1) : tall(i + 1)));
    const placed = autoLayout(photos, 0.85);
    assert.equal(placed.length, n);
    const total = placed.reduce((a, p) => a + area(p.rect), 0);
    assert.ok(Math.abs(total - 1) < 1e-6, `n=${n} covers ${total}`);
    for (const p of placed) {
      assert.ok(p.rect.x >= -1e-9 && p.rect.y >= -1e-9 && p.rect.x + p.rect.w <= 1 + 1e-9 && p.rect.y + p.rect.h <= 1 + 1e-9);
    }
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = placed[i].rect, b = placed[j].rect;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        assert.ok(ox <= 1e-6 || oy <= 1e-6, `n=${n}: frames ${i} and ${j} overlap`);
      }
  }
});

test("the best photo gets the biggest frame", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const photos = Array.from({ length: n }, (_, i) => wide(i + 1, i === n - 1 ? 2 : 0.5));
    const placed = autoLayout(photos, 0.85);
    const hero = placed.find((p) => p.id === n)!;
    for (const p of placed) if (p.id !== n) assert.ok(area(hero.rect) >= area(p.rect) - 1e-6, `n=${n}`);
  }
});

test("a tall photo gets a tall frame, a wide photo a wide frame", () => {
  const placed = autoLayout([tall(1, 1), wide(2), wide(3)], 0.85);
  const t = placed.find((p) => p.id === 1)!.rect, w2 = placed.find((p) => p.id === 2)!.rect;
  assert.ok((t.w * 0.85) / t.h < 1, "tall photo in a tall frame");
  assert.ok((t.w * 0.85) / t.h < (w2.w * 0.85) / w2.h, "the wide photo's frame is wider");
});

test("faces at the edge of a photo stay in the frame", () => {
  // A wide photo with a face near its left edge, in a page that will crop it.
  const face = { x: 0.04, y: 0.3, w: 0.08, h: 0.12 };
  const placed = autoLayout([wide(1, 1, [face]), tall(2), tall(3)], 0.85);
  for (const p of placed) {
    const r = p.rect;
    const shape = (r.w * 0.85) / r.h;
    const src = p.id === 1 ? wide(1, 1, [face]) : tall(p.id);
    assert.equal(facesCut(src.w, src.h, shape, src.faces), 0);
  }
  // One wide photo on a tall page is cut at the sides: the face side is kept.
  const [one] = autoLayout([wide(1, 1, [face])], 0.7);
  assert.ok(one.pos[0] < 10, `kept to the left (${one.pos[0]}%)`);
});

test("the same photos always give the same page", () => {
  const photos = [wide(4), tall(9), wide(12, 1), tall(15), wide(20)];
  assert.deepEqual(autoLayout(photos, 0.85), autoLayout(photos, 0.85));
});
