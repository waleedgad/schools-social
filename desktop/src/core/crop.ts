// Face-aware cropping, shared by posts (features/posts.ts) and yearbook
// pages (core/book-layout.ts). Pure: no Electron, no sharp.

export type Box = { x: number; y: number; w: number; h: number };

// Where to cut a photo of width W and height H to the ratio r so that every
// face stays in, with room around it: hair above each face, a little space
// at the sides. When they can't all fit, the cut keeps the most face (big
// faces count more) and never runs through the middle of a face.
export function smartCrop(W: number, H: number, r: number, faces: Box[]) {
  if (W / H > r) {
    const w = Math.min(W, Math.round(H * r));
    if (!faces.length) return { left: Math.round((W - w) / 2), top: 0, width: w, height: H };
    const spans = faces.map((f) => ({ a: (f.x - f.w * 0.25) * W, b: (f.x + f.w * 1.25) * W, core: [f.x * W, (f.x + f.w) * W] as const, weight: f.w }));
    return { left: place(W, w, spans, 0.5), top: 0, width: w, height: H };
  }
  const h = Math.min(H, Math.round(W / r));
  if (!faces.length) return { left: 0, top: Math.round(Math.max(0, (H - h) * 0.35)), width: W, height: h };
  // Hair above a face is about half its height; shoulders below it.
  const spans = faces.map((f) => ({ a: (f.y - f.h * 0.6) * H, b: (f.y + f.h * 1.3) * H, core: [(f.y - f.h * 0.15) * H, (f.y + f.h) * H] as const, weight: f.w }));
  // Faces sit a little above the middle, room for bodies under them.
  return { left: 0, top: place(H, h, spans, 0.3), width: W, height: h };
}

// One side of smartCrop: where a window of length win starts along len.
// Every span (a face with its room) inside if they fit, placed so the spare
// space is split `lead` before and the rest after. If not, the start that
// keeps the most face, with a face cut through (its core part in and part
// out) counting against it; ties go to the faces' weighted middle.
function place(len: number, win: number, spans: { a: number; b: number; core: readonly [number, number]; weight: number }[], lead: number) {
  const clampStart = (v: number) => Math.round(Math.min(len - win, Math.max(0, v)));
  const lo = Math.min(...spans.map((s) => s.a)), hi = Math.max(...spans.map((s) => s.b));
  if (hi - lo <= win) return clampStart(lo - (win - (hi - lo)) * lead);
  const mid = spans.reduce((t, s) => t + ((s.core[0] + s.core[1]) / 2) * s.weight, 0) / spans.reduce((t, s) => t + s.weight, 0);
  // Starts worth trying: the middle, and each face's edges against either side.
  const starts = new Set<number>([clampStart(mid - win / 2)]);
  for (const s of spans) for (const v of [s.a, s.core[0], s.b - win, s.core[1] - win]) starts.add(clampStart(v));
  let best = clampStart(mid - win / 2), bestScore = -Infinity;
  for (const st of starts) {
    const en = st + win;
    let score = 0;
    for (const s of spans) {
      const [c0, c1] = s.core;
      if (c0 >= st && c1 <= en) score += s.weight * (s.a >= st && s.b <= en ? 1 : 0.9);
      else if (c1 > st && c0 < en) score -= s.weight * 1.5;
    }
    score -= (Math.abs(st + win / 2 - mid) / len) * 0.01;
    if (score > bestScore) (bestScore = score), (best = st);
  }
  return best;
}
