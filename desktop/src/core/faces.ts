import path from "node:path";
import sharp from "sharp";

// Local face finding and matching. Nothing here leaves the computer.
//   YuNet    finds faces and five landmarks (eyes, nose, mouth corners).
//   AuraFace turns an aligned 112×112 face into 512 numbers; the same student
//            gives close numbers in different photos (Apache 2.0, free for
//            commercial use; downloaded on first run).
//   SFace    the older, smaller recogniser (128 numbers), used until AuraFace
//            is on this computer.
// All run with ONNX Runtime, the same on Mac and Windows, so names and face
// data work across both.

type Ort = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;

export type Face = {
  box: [number, number, number, number]; // x, y, w, h as fractions of the photo
  score: number;
  landmarks: number[]; // 10 values in pixels of the analysed image
  embedding: Float32Array; // 128 (SFace) or 512 (AuraFace), unit length
  // Too small, blurred, side-on or not really a face (a hand, a tambourine):
  // kept as "background" and never suggested as anyone.
  usable: boolean;
  why: string | null;
  sharpness: number;
};

export type Recogniser = "sface" | "aura";

const SIZE = 640;
const SCORE = 0.8;
const NMS = 0.3;
// Match scores are shown on one scale whatever the recogniser: 0.5 means
// "possibly", 0.62 "sure". Each recogniser's raw cosine is mapped onto it.
//   SFace's published "same person" cosine is 0.363.
//   AuraFace (ArcFace-class): same person is usually above 0.3, sure above 0.5.
const SCALE: Record<Recogniser, { same: number; show: number; sure: number }> = {
  sface: { same: 0.363, show: 0.5, sure: 0.62 },
  aura: { same: 0.28, show: 0.38, sure: 0.52 },
};
export function scaled(raw: number, r: Recogniser) {
  const k = SCALE[r];
  if (r === "sface") return raw;
  // piecewise-linear: same -> 0.363, show -> 0.5, sure -> 0.62, 1 -> 1
  const pts: [number, number][] = [[0, 0], [k.same, 0.363], [k.show, 0.5], [k.sure, 0.62], [1, 1]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (raw <= x1) return y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}
export const SAME_PERSON = 0.363;
// Below this, a suggestion is a guess and isn't shown (Waleed, Oct 2026).
export const SHOW_FROM = 0.5;
// A match this strong, well clear of the next student, is named by itself
// and marked "auto" so it can be checked later.
export const SURE = 0.62;
export const SURE_GAP = 0.12;
// Twins and look-alike siblings need a much clearer lead before a name is given.
export const TWIN_GAP = 0.2;
export const isSure = (m: { score: number; runnerUp: number; twin?: boolean } | null) =>
  !!m && m.score >= SURE && m.score - m.runnerUp >= (m.twin ? TWIN_GAP : SURE_GAP);

// Where SFace expects the landmarks in its 112×112 input.
const REFERENCE = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export const AURA_FILE = "auraface_glintr100.onnx";
export const AURA_URL = "https://huggingface.co/fal/AuraFace-v1/resolve/main/glintr100.onnx";

type Loaded = { ort: Ort; detector: Session; recognizer: Session; kind: Recogniser };
const loaded = new Map<string, Promise<Loaded>>();

// modelsDir holds YuNet and SFace (shipped with the app); auraFile, when
// given and present, is the downloaded AuraFace model.
export function loadModels(modelsDir: string, auraFile?: string | null) {
  const key = `${modelsDir}|${auraFile ?? ""}`;
  if (!loaded.has(key)) {
    loaded.set(
      key,
      (async () => {
        const ort: Ort = require("onnxruntime-node");
        const options = { logSeverityLevel: 3 as const, intraOpNumThreads: 2 };
        const detector = await ort.InferenceSession.create(path.join(modelsDir, "face_detection_yunet_2023mar.onnx"), options);
        if (auraFile) {
          const recognizer = await ort.InferenceSession.create(auraFile, options);
          return { ort, detector, recognizer, kind: "aura" as const };
        }
        const recognizer = await ort.InferenceSession.create(path.join(modelsDir, "face_recognition_sface_2021dec.onnx"), options);
        return { ort, detector, recognizer, kind: "sface" as const };
      })(),
    );
  }
  return loaded.get(key)!;
}

function iou(a: number[], b: number[]) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

type Raw = { box: number[]; score: number; landmarks: number[] };

// Decodes YuNet's three output scales (8, 16, 32 px) like OpenCV's FaceDetectorYN.
export function decode(out: Record<string, { data: unknown }>, size = SIZE, threshold = SCORE): Raw[] {
  const found: Raw[] = [];
  for (const stride of [8, 16, 32]) {
    const cls = out[`cls_${stride}`].data as Float32Array;
    const obj = out[`obj_${stride}`].data as Float32Array;
    const bbox = out[`bbox_${stride}`].data as Float32Array;
    const kps = out[`kps_${stride}`].data as Float32Array;
    const cols = size / stride;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < threshold) continue;
      const r = Math.floor(i / cols);
      const c = i % cols;
      const cx = (c + bbox[i * 4]) * stride;
      const cy = (r + bbox[i * 4 + 1]) * stride;
      const w = Math.exp(bbox[i * 4 + 2]) * stride;
      const h = Math.exp(bbox[i * 4 + 3]) * stride;
      const landmarks: number[] = [];
      for (let n = 0; n < 5; n++) landmarks.push((kps[i * 10 + n * 2] + c) * stride, (kps[i * 10 + n * 2 + 1] + r) * stride);
      found.push({ box: [cx - w / 2, cy - h / 2, w, h], score, landmarks });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept: Raw[] = [];
  for (const f of found) if (kept.every((k) => iou(k.box, f.box) < NMS)) kept.push(f);
  return kept;
}

// Least-squares similarity transform (Umeyama) mapping src points onto dst.
export function similarity(src: number[][], dst: number[][]) {
  const n = src.length;
  const mean = (p: number[][], k: number) => p.reduce((s, q) => s + q[k], 0) / n;
  const sx = mean(src, 0), sy = mean(src, 1), dx = mean(dst, 0), dy = mean(dst, 1);
  let a = 0, b = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - sx, y = src[i][1] - sy, u = dst[i][0] - dx, v = dst[i][1] - dy;
    a += x * u + y * v;
    b += x * v - y * u;
    norm += x * x + y * y;
  }
  a /= norm;
  b /= norm;
  // [u, v] = [[a, -b], [b, a]] · [x, y] + [tx, ty]
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}

// Cuts the face out, upright and scaled to 112×112, by sampling the source
// through the inverse transform.
export function align(rgb: Buffer, width: number, height: number, landmarks: number[], kind: Recogniser = "sface") {
  const src = [0, 1, 2, 3, 4].map((i) => [landmarks[i * 2], landmarks[i * 2 + 1]]);
  const { a, b, tx, ty } = similarity(src, REFERENCE);
  const det = a * a + b * b;
  const out = new Float32Array(3 * 112 * 112);
  const plane = 112 * 112;
  for (let v = 0; v < 112; v++) {
    for (let u = 0; u < 112; u++) {
      const px = u - tx, py = v - ty;
      const x = (a * px + b * py) / det;
      const y = (-b * px + a * py) / det;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      for (let ch = 0; ch < 3; ch++) {
        const at = (xx: number, yy: number) =>
          xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : rgb[(yy * width + xx) * 3 + ch];
        const value =
          at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
        // SFace takes RGB 0-255; AuraFace RGB scaled to -1..1.
        out[ch * plane + v * 112 + u] = kind === "aura" ? (value - 127.5) / 127.5 : value;
      }
    }
  }
  return out;
}

function unit(v: Float32Array) {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Finds every face in a photo file and describes each one.
export type FindOptions = { aura?: string | null; vision?: (jpeg: Buffer) => Promise<VisionFace[] | null> };
export type VisionFace = { box: [number, number, number, number]; quality: number };

export async function findFaces(modelsDir: string, file: string | Buffer, o: FindOptions = {}): Promise<Face[] & { recogniser?: Recogniser }> {
  const { ort, detector, recognizer, kind } = await loadModels(modelsDir, o.aura);
  // Analyse at up to 2000 px: big enough for small faces in a class photo.
  const { data: rgb, info } = await sharp(file, { failOn: "none" })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  // Large group photos are scanned in overlapping 640 px tiles as well as whole,
  // so small faces at the back of the class are still found.
  const views: { x: number; y: number; scale: number }[] = [{ x: 0, y: 0, scale: Math.max(width, height) / SIZE }];
  if (Math.max(width, height) > 1000) {
    const tile = Math.round(Math.max(width, height) / 2);
    for (let y = 0; y < height; y += Math.round(tile * 0.75)) {
      for (let x = 0; x < width; x += Math.round(tile * 0.75)) {
        views.push({ x: Math.min(x, Math.max(0, width - tile)), y: Math.min(y, Math.max(0, height - tile)), scale: tile / SIZE });
        if (x + tile >= width) break;
      }
      if (y + tile >= height) break;
    }
  }

  const all: Raw[] = [];
  for (const view of views) {
    const side = Math.round(SIZE * view.scale);
    const crop = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .extract({ left: view.x, top: view.y, width: Math.min(side, width - view.x), height: Math.min(side, height - view.y) })
      .resize({ width: SIZE, height: SIZE, fit: "contain", position: "left top", background: { r: 0, g: 0, b: 0 } })
      .raw()
      .toBuffer();
    // YuNet takes BGR, 0-255, channels first.
    const input = new Float32Array(3 * SIZE * SIZE);
    const plane = SIZE * SIZE;
    for (let i = 0; i < plane; i++) {
      input[i] = crop[i * 3 + 2];
      input[plane + i] = crop[i * 3 + 1];
      input[2 * plane + i] = crop[i * 3];
    }
    const out = await detector.run({ input: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
    const contain = Math.min(SIZE / Math.min(side, width - view.x), SIZE / Math.min(side, height - view.y));
    for (const f of decode(out as never)) {
      const k = 1 / contain;
      all.push({
        score: f.score,
        box: [f.box[0] * k + view.x, f.box[1] * k + view.y, f.box[2] * k, f.box[3] * k],
        landmarks: f.landmarks.map((v, i) => v * k + (i % 2 ? view.y : view.x)),
      });
    }
  }
  all.sort((a, b) => b.score - a.score);
  const faces: Raw[] = [];
  for (const f of all) {
    if (f.box[2] < 24 || f.box[3] < 24) continue; // too small to find anyone
    if (faces.every((k) => iou(k.box, f.box) < NMS && !inside(f.box, k.box))) faces.push(f);
  }

  // On the Mac, Apple Vision looks at the photo too. A "face" Vision doesn't
  // see (a hand, a drum, a pattern) or rates as very poor is left out.
  let vision: VisionFace[] | null = null;
  if (o.vision && faces.length) {
    const jpeg = await sharp(rgb, { raw: { width, height, channels: 3 } }).resize({ width: 1600, height: 1600, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
    vision = await o.vision(jpeg).catch(() => null);
  }

  const result: Face[] = [];
  const inputName = recognizer.inputNames[0];
  for (const f of faces) {
    const aligned = align(rgb, width, height, f.landmarks, kind);
    const out = await recognizer.run({ [inputName]: new ort.Tensor("float32", aligned, [1, 3, 112, 112]) });
    const embedding = unit(Float32Array.from(out[recognizer.outputNames[0]].data as Float32Array));
    const [x, y, w, h] = f.box;
    const box: Face["box"] = [clamp(x / width), clamp(y / height), clamp(w / width), clamp(h / height)];
    const sharpness = faceSharpness(aligned, kind);
    let why = faceProblem(f, sharpness, width, height);
    if (!why && vision) {
      const v = vision.find((vf) => iou(vf.box, box) > 0.25 || inside(box, vf.box));
      if (!v) why = "not-a-face";
      else if (v.quality < 0.12) why = "blurred";
    }
    result.push({ box, score: f.score, landmarks: f.landmarks, embedding, usable: !why, why, sharpness });
  }
  return Object.assign(result, { recogniser: kind });
}

// How crisp the face itself is: variance of the Laplacian on the aligned
// 112 px face (grey). A face in the blurred background scores low.
export function faceSharpness(aligned: Float32Array, kind: Recogniser = "sface") {
  const plane = 112 * 112;
  const grey = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    const v = (aligned[i] + aligned[plane + i] + aligned[2 * plane + i]) / 3;
    grey[i] = kind === "aura" ? v * 127.5 + 127.5 : v;
  }
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 20; y < 100; y++) {
    for (let x = 20; x < 92; x++) {
      const i = y * 112 + x;
      const lap = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - 112] - grey[i + 112];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  return sum2 / n - (sum / n) ** 2;
}

// Why a detection shouldn't be suggested as anyone, or null when it's fine.
// Hands and objects rarely have eyes above a nose above a mouth.
export function faceProblem(f: { box: number[]; score: number; landmarks: number[] }, sharpness: number, width: number, height: number): string | null {
  const [x, y, w, h] = f.box;
  const lm = f.landmarks;
  const longSide = Math.max(width, height);
  if (w < 40 || h < 40 || w / longSide < 0.018) return "too-small";
  if (f.score < 0.86) return "unsure";
  const ratio = w / h;
  if (ratio < 0.55 || ratio > 1.45) return "not-a-face";
  const [lx, ly, rx, ry, nx, ny, mlx, mly, mrx, mry] = lm;
  const eyeY = (ly + ry) / 2, mouthY = (mly + mry) / 2;
  const eyeGap = Math.hypot(rx - lx, ry - ly);
  if (!(eyeY < ny && ny < mouthY)) return "not-a-face";
  if (eyeGap < w * 0.22) return "side-on";
  if (nx < Math.min(lx, rx) - eyeGap * 0.6 || nx > Math.max(lx, rx) + eyeGap * 0.6) return "side-on";
  const inBox = (px: number, py: number) => px > x - w * 0.1 && px < x + w * 1.1 && py > y - h * 0.1 && py < y + h * 1.1;
  for (let i = 0; i < 5; i++) if (!inBox(lm[i * 2], lm[i * 2 + 1])) return "not-a-face";
  if (sharpness < 12) return "blurred";
  return null;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
function inside(a: number[], b: number[]) {
  const cx = a[0] + a[2] / 2, cy = a[1] + a[3] / 2;
  return cx > b[0] && cx < b[0] + b[2] && cy > b[1] && cy < b[1] + b[3];
}

export type Known = { studentId: string; embedding: Float32Array; className?: string | null; kind?: string | null; gender?: string | null; at?: string | null; penalty?: number };
export type Match = { studentId: string; score: number; runnerUp: number; twin?: boolean };

// Every candidate for one face, best first: the closest known face of each
// person, on the shared 0-1 scale.
export function ranked(embedding: Float32Array, known: Known[], r: Recogniser = "sface") {
  const best = new Map<string, number>();
  for (const k of known) {
    if (k.embedding.length !== embedding.length) continue;
    // Faces grow: an example from years before or after counts a little less.
    const s = cosine(embedding, k.embedding) - (k.penalty ?? 0);
    if (s > (best.get(k.studentId) ?? -1)) best.set(k.studentId, s);
  }
  return [...best.entries()].map(([studentId, raw]) => ({ studentId, score: scaled(raw, r) })).sort((a, b) => b.score - a.score);
}

// The person whose known faces are closest, if close enough.
export function bestMatch(embedding: Float32Array, known: Known[], r: Recogniser = "sface"): Match | null {
  const list = ranked(embedding, known, r);
  if (!list.length || list[0].score < SAME_PERSON) return null;
  return { studentId: list[0].studentId, score: list[0].score, runnerUp: list[1]?.score ?? 0 };
}

// One photo, many faces: a person appears in a photo at most once. The
// strongest face-person pair wins; the other faces get their next-best
// person or stay unknown. "taken" are people already named in the photo.
export function assignPhoto(embeddings: (Float32Array | null)[], known: Known[], r: Recogniser = "sface", taken: Set<string> = new Set(), allowed?: (face: number, studentId: string) => boolean): (Match | null)[] {
  const lists = embeddings.map((e, i) => (e ? ranked(e, known, r).filter((c) => !allowed || allowed(i, c.studentId)).slice(0, 8) : []));
  const pairs: { face: number; studentId: string; score: number }[] = [];
  lists.forEach((l, face) => l.forEach((c) => c.score >= SAME_PERSON && pairs.push({ face, ...c })));
  pairs.sort((a, b) => b.score - a.score);
  const out: (Match | null)[] = embeddings.map(() => null);
  const used = new Set(taken);
  for (const p of pairs) {
    if (out[p.face] || used.has(p.studentId)) continue;
    const runnerUp = lists[p.face].find((c) => c.studentId !== p.studentId)?.score ?? 0;
    out[p.face] = { studentId: p.studentId, score: p.score, runnerUp };
    used.add(p.studentId);
  }
  return out;
}

// What a face looks like it is, learned only from the school's own named
// faces (no outside model): boy or girl, student or adult. Each group's
// average face is compared; a clear lead gives an answer, else null.
export type Traits = { female?: Float32Array; male?: Float32Array; adult?: Float32Array; student?: Float32Array };
export function traitCentres(known: Known[], dims: number): Traits {
  const acc: Record<string, { v: Float32Array; n: number }> = {};
  const add = (key: string, e: Float32Array) => {
    acc[key] ??= { v: new Float32Array(dims), n: 0 };
    for (let i = 0; i < dims; i++) acc[key].v[i] += e[i];
    acc[key].n++;
  };
  for (const k of known) {
    if (k.embedding.length !== dims) continue;
    if (k.gender === "F") add("female", k.embedding);
    if (k.gender === "M") add("male", k.embedding);
    add(k.kind && k.kind !== "student" ? "adult" : "student", k.embedding);
  }
  const out: Traits = {};
  for (const [key, a] of Object.entries(acc)) if (a.n >= 12) out[key as keyof Traits] = unit(a.v);
  return out;
}

export function guessTraits(e: Float32Array, t: Traits) {
  const pick = (a?: Float32Array, b?: Float32Array, gap = 0.06) => {
    if (!a || !b || a.length !== e.length) return 0;
    const d = cosine(e, a) - cosine(e, b);
    return d > gap ? 1 : d < -gap ? -1 : 0;
  };
  const g = pick(t.female, t.male);
  const age = pick(t.adult, t.student, 0.08);
  return { gender: g === 1 ? "F" : g === -1 ? "M" : null, adult: age === 1 ? true : age === -1 ? false : null };
}
