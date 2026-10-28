import path from "node:path";
import sharp from "sharp";

// Local face finding and matching. Nothing here leaves the computer.
//   YuNet  finds faces and five landmarks (eyes, nose, mouth corners).
//   SFace  turns an aligned 112×112 face into 128 numbers; the same student
//          gives close numbers in different photos.
// Both are OpenCV Zoo models run with ONNX Runtime.

type Ort = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;

export type Face = {
  box: [number, number, number, number]; // x, y, w, h as fractions of the photo
  score: number;
  landmarks: number[]; // 10 values in pixels of the analysed image
  embedding: Float32Array; // 128, unit length
};

const SIZE = 640;
const SCORE = 0.8;
const NMS = 0.3;
// SFace's published cosine threshold for "same person" is 0.363.
export const SAME_PERSON = 0.363;
// Below this, a suggestion is a guess and isn't shown (Waleed, Oct 2026).
export const SHOW_FROM = 0.5;
// A match this strong, well clear of the next student, is named by itself
// and marked "auto" so it can be checked later.
export const SURE = 0.62;
export const SURE_GAP = 0.12;
export const isSure = (m: { score: number; runnerUp: number } | null) => !!m && m.score >= SURE && m.score - m.runnerUp >= SURE_GAP;

// Where SFace expects the landmarks in its 112×112 input.
const REFERENCE = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

let loaded: Promise<{ ort: Ort; detector: Session; recognizer: Session }> | null = null;

export function loadModels(modelsDir: string) {
  loaded ??= (async () => {
    const ort: Ort = require("onnxruntime-node");
    const options = { logSeverityLevel: 3 as const, intraOpNumThreads: 2 };
    const detector = await ort.InferenceSession.create(path.join(modelsDir, "face_detection_yunet_2023mar.onnx"), options);
    const recognizer = await ort.InferenceSession.create(path.join(modelsDir, "face_recognition_sface_2021dec.onnx"), options);
    return { ort, detector, recognizer };
  })();
  return loaded;
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
export function align(rgb: Buffer, width: number, height: number, landmarks: number[]) {
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
        out[ch * plane + v * 112 + u] = value; // SFace takes RGB, 0-255
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
export async function findFaces(modelsDir: string, file: string | Buffer): Promise<Face[]> {
  const { ort, detector, recognizer } = await loadModels(modelsDir);
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
    if (f.box[2] < 24 || f.box[3] < 24) continue; // too small to recognise
    if (faces.every((k) => iou(k.box, f.box) < NMS && !inside(f.box, k.box))) faces.push(f);
  }

  const result: Face[] = [];
  for (const f of faces) {
    const aligned = align(rgb, width, height, f.landmarks);
    const out = await recognizer.run({ data: new ort.Tensor("float32", aligned, [1, 3, 112, 112]) });
    const embedding = unit(Float32Array.from(out[recognizer.outputNames[0]].data as Float32Array));
    const [x, y, w, h] = f.box;
    result.push({
      box: [clamp(x / width), clamp(y / height), clamp(w / width), clamp(h / height)],
      score: f.score,
      landmarks: f.landmarks,
      embedding,
    });
  }
  return result;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
function inside(a: number[], b: number[]) {
  const cx = a[0] + a[2] / 2, cy = a[1] + a[3] / 2;
  return cx > b[0] && cx < b[0] + b[2] && cy > b[1] && cy < b[1] + b[3];
}

// The student whose known faces are closest, if close enough.
export function bestMatch(embedding: Float32Array, known: { studentId: string; embedding: Float32Array }[]) {
  const best = new Map<string, number>();
  for (const k of known) {
    const s = cosine(embedding, k.embedding);
    if (s > (best.get(k.studentId) ?? -1)) best.set(k.studentId, s);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < SAME_PERSON) return null;
  return { studentId: ranked[0][0], score: ranked[0][1], runnerUp: ranked[1]?.[1] ?? 0 };
}
