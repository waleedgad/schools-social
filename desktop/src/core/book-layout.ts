import { smartCrop, type Box } from "./crop";

// Automatic layout for a yearbook page: the photos are arranged in a tree of
// side-by-side and stacked splits, so each frame gets close to its photo's
// own shape (a tall photo in a tall frame, a wide one in a wide frame). The
// best photo gets the biggest frame. Each photo is then placed in its frame
// so its faces stay in (the same face-aware crop the posts use), and a
// layout that would cut through a face loses to one that doesn't.
// Pure and repeatable: the same photos always give the same page.

export type LPhoto = { id: number; w: number; h: number; faces: Box[]; score: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Placed = { id: number; rect: Rect; pos: [number, number] };

type Node = { leaf: number } | { split: "h" | "v"; a: Node; b: Node };

const aspectOf = (n: Node, ar: number[]): number => {
  if ("leaf" in n) return ar[n.leaf];
  const a = aspectOf(n.a, ar), b = aspectOf(n.b, ar);
  return n.split === "h" ? a + b : 1 / (1 / a + 1 / b);
};

function rects(n: Node, ar: number[], r: Rect, out: Rect[]) {
  if ("leaf" in n) {
    out[n.leaf] = r;
    return;
  }
  const a = aspectOf(n.a, ar), b = aspectOf(n.b, ar);
  if (n.split === "h") {
    const wa = r.w * (a / (a + b));
    rects(n.a, ar, { x: r.x, y: r.y, w: wa, h: r.h }, out);
    rects(n.b, ar, { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h }, out);
  } else {
    const ha = r.h * (1 / a / (1 / a + 1 / b));
    rects(n.a, ar, { x: r.x, y: r.y, w: r.w, h: ha }, out);
    rects(n.b, ar, { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha }, out);
  }
}

// A small seeded random number source, so a page always comes out the same.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function randomTree(items: number[], rand: () => number): Node {
  if (items.length === 1) return { leaf: items[0] };
  const cut = 1 + Math.floor(rand() * (items.length - 1));
  return { split: rand() < 0.5 ? "h" : "v", a: randomTree(items.slice(0, cut), rand), b: randomTree(items.slice(cut), rand) };
}

// Where to show a photo of W x H in a frame of shape r, as CSS object-position.
export function facePosition(W: number, H: number, r: number, faces: Box[]): [number, number] {
  if (!W || !H) return [50, 50];
  const c = smartCrop(W, H, r, faces);
  const px = c.width < W ? (c.left / (W - c.width)) * 100 : 50;
  const py = c.height < H ? (c.top / (H - c.height)) * 100 : 50;
  return [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
}

// How many faces a crop to shape r would cut through (part in, part out).
export function facesCut(W: number, H: number, r: number, faces: Box[]) {
  if (!faces.length || !W || !H) return 0;
  const c = smartCrop(W, H, r, faces);
  let cut = 0;
  for (const f of faces) {
    const x0 = f.x * W, x1 = (f.x + f.w) * W, y0 = f.y * H, y1 = (f.y + f.h) * H;
    const inX = x0 >= c.left - 0.5 && x1 <= c.left + c.width + 0.5, inY = y0 >= c.top - 0.5 && y1 <= c.top + c.height + 0.5;
    const outX = x1 <= c.left || x0 >= c.left + c.width, outY = y1 <= c.top || y0 >= c.top + c.height;
    if (!(inX && inY) && !(outX || outY)) cut++;
  }
  return cut;
}

// Lays out photos in an area of shape `area` (width / height).
export function autoLayout(photos: LPhoto[], area: number, trials = 700): Placed[] {
  const n = photos.length;
  if (!n) return [];
  const ar = photos.map((p) => (p.w && p.h ? Math.min(3, Math.max(1 / 3, p.w / p.h)) : 1.5));
  if (n === 1) return [{ id: photos[0].id, rect: { x: 0, y: 0, w: 1, h: 1 }, pos: facePosition(photos[0].w, photos[0].h, area, photos[0].faces) }];
  const hero = photos.reduce((b, p, i) => (p.score > photos[b].score ? i : b), 0);
  const rand = rng(photos.reduce((a, p) => (a * 31 + p.id) | 0, n));
  const order = photos.map((_, i) => i);
  let best: { cost: number; rs: Rect[] } | null = null;
  for (let t = 0; t < trials; t++) {
    // Shuffle the order a little each try (the first try keeps it as given).
    const items = [...order];
    if (t) for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    const tree = randomTree(items, rand);
    const rs: Rect[] = [];
    // The frames are drawn in a box of shape `area`: x in [0, area], y in [0, 1].
    rects(tree, ar, { x: 0, y: 0, w: area, h: 1 }, rs);
    let cost = 0;
    const total = area;
    let biggest = 0;
    for (let i = 0; i < n; i++) {
      const r = rs[i], cellAr = r.w / r.h, size = (r.w * r.h) / total;
      cost += Math.abs(Math.log(cellAr / ar[i])) * size * 2;
      cost += facesCut(photos[i].w, photos[i].h, cellAr, photos[i].faces) * 1.5;
      if (size < 0.4 / n) cost += (0.4 / n - size) * 12;
      if (cellAr > 3.2 || cellAr < 1 / 3.2) cost += 1;
      if (i !== hero) biggest = Math.max(biggest, size);
    }
    const heroSize = (rs[hero].w * rs[hero].h) / total;
    if (biggest > heroSize * 0.95) cost += (biggest / heroSize - 0.95) * 1.2;
    if (!best || cost < best.cost - 1e-9) best = { cost, rs };
  }
  return photos.map((p, i) => {
    const r = best!.rs[i];
    return { id: p.id, rect: { x: r.x / area, y: r.y, w: r.w / area, h: r.h }, pos: facePosition(p.w, p.h, r.w / r.h, p.faces) };
  });
}
