import path from "node:path";
import sharp from "sharp";

// Local face finding and matching. Nothing here leaves the computer.
//   YuNet    finds faces and five landmarks (eyes, nose, mouth corners).
//   AuraFace turns an aligned 112×112 face into 512 numbers; the same student
//            gives close numbers in different photos (Apache 2.0, free for
//            commercial use; downloaded on first run).
//   SFace    the older, smaller recogniser (128 numbers), used until AuraFace
//            is on this computer.
// Once AuraFace is here, both look at every face and their descriptions are
// joined ("both", 640 numbers): each catches mistakes the other makes.
// All run with ONNX Runtime, the same on Mac and Windows, so names and face
// data work across both.

type Ort = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;

export type Face = {
  box: [number, number, number, number]; // x, y, w, h as fractions of the photo
  score: number;
  landmarks: number[]; // 10 values in pixels of the analysed image
  embedding: Float32Array; // 128 (SFace) or 640 (both), unit length
  // Too small, blurred, side-on or not really a face (a hand, a tambourine):
  // kept as "background" and never suggested as anyone.
  usable: boolean;
  why: string | null;
  sharpness: number;
  // The face's width in the best pixels it was read from (the original
  // photo's own pixels, up to HI_RES on the long side).
  px?: number;
  // The face finder's confidence on the whole photo, and on its closer
  // second look at just this face (null: it saw no face there).
  detScore?: number;
  zoomScore?: number | null;
  // Other ways of describing the same face, for the face test only.
  variants?: Record<string, Float32Array>;
};

export type Recogniser = "sface" | "aura" | "both";

const SIZE = 640;
const SCORE = 0.8;
const NMS = 0.3;
// Match scores are shown on one scale whatever the recogniser: 0.5 means
// "possibly", 0.62 "sure". Each recogniser's raw cosine is mapped onto it.
//   SFace's published "same person" cosine is 0.363.
//   AuraFace (ArcFace-class): same person is usually above 0.3, sure above 0.5.
// AuraFace's "sure" and its lead over the next student, raw (see isSure).
const AURA_SURE = 0.47;
const AURA_GAP = 0.08;
// Both together (0.7 x AuraFace + 0.3 x SFace): face test, class of 30, no
// names wrong at 0.45 with any lead from 0.04 up (6 Nov 2026).
const BOTH_SURE = 0.45;
const BOTH_GAP = 0.06;
export const BOTH_AURA = 0.7;
const SCALE: Record<Recogniser, { same: number; show: number; sure: number }> = {
  sface: { same: 0.363, show: 0.5, sure: 0.62 },
  aura: { same: 0.28, show: 0.38, sure: AURA_SURE },
  both: { same: 0.27, show: 0.36, sure: BOTH_SURE },
};
// The raw score behind a shown score (the reverse of scaled).
export function unscaled(shown: number, r: Recogniser) {
  if (r === "sface") return shown;
  const k = SCALE[r];
  const pts: [number, number][] = [[0, 0], [0.363, k.same], [0.5, k.show], [0.62, k.sure], [1, 1]];
  if (shown <= 0) return shown;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (shown <= x1) return y0 + ((shown - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

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
// Suggestions are only shown when they are right at least 9 times in 10 in
// the face test (strangers counted as wrong), and are labelled in words, not
// a %: a shown score is how alike two faces are, not a chance (Waleed, 7 Nov
// 2026: "it should only suggest 90%+"). Below SHOW_FROM a match is a guess:
// it never becomes a suggestion and only appears under "More…".
// Face test, 7 Nov 2026 (both recognisers, faces not named by themselves):
// 40-50% right 3-58% of the time, 50-55% 50-81%, 55-60% 91-98%, 60-62% 100%.
export const SHOW_FROM = 0.55;
export const VERY_LIKELY = 0.6;
export type Likelihood = "very" | "likely" | null;
export function likelihood(score: number | null | undefined): Likelihood {
  if (score == null || !(score >= SHOW_FROM)) return null;
  return score >= VERY_LIKELY ? "very" : "likely";
}
// Far and blurred faces are never suggested and get no "?" prompt; a sure
// match still names them. Face test, 7 Nov 2026, from 55%: faces under 60 px
// 91% right, 60-90 px 100%, bigger 98-100%; masks, sunglasses, hats, hands,
// low light 95-100%, motion blur 93%. 90 px keeps a margin (Waleed: no
// suggestions for far faces).
export const SUGGEST_PX = 90; // face width in the photo's own pixels
export const SUGGEST_SHARP = 25; // faceSharpness of the aligned face
// A face's width in the photo's own pixels. Faces are found on a copy at
// most 2000 px on the long side, but each face is then read (described)
// from the original, up to HI_RES px: a student at the back of a class photo
// from a good camera is 150 px wide there, not 50.
export const HI_RES = 6000;
export function facePx(boxW: number, width: number | null | undefined, height: number | null | undefined) {
  if (!width || !height) return Infinity;
  return boxW * width * Math.min(1, HI_RES / Math.max(width, height));
}
export function clearEnough(px: number, sharpness: number | null | undefined) {
  return px >= SUGGEST_PX && (sharpness == null || sharpness >= SUGGEST_SHARP);
}
// A match this strong, well clear of the next student, is named by itself
// and marked "auto" so it can be checked later.
export const SURE = 0.62;
export const SURE_GAP = 0.12;
// Twins and look-alike siblings need a much clearer lead before a name is given.
export const TWIN_GAP = 0.2;
// "Sure" is decided on each recogniser's own raw score: how close the face is
// to the student's nearest confirmed face, and how far ahead of the next
// student. The values come from the face test on stand-in photos
// (desktop/bench/faces, 6 Nov 2026), set a little above the best value found
// to keep strangers (parents, visitors) from being named. Class of 30, 3
// confirmed faces each, named by themselves with none wrong: AuraFace 78%,
// both together 82%, both together and learning from their own sure names
// (see learnFrom) 88% (91% with 5 confirmed faces).
const SURE_RAW: Record<Recogniser, { sure: number; gap: number; twin: number }> = {
  sface: { sure: SURE, gap: SURE_GAP, twin: TWIN_GAP },
  aura: { sure: AURA_SURE, gap: AURA_GAP, twin: AURA_GAP + 0.08 },
  both: { sure: BOTH_SURE, gap: BOTH_GAP, twin: BOTH_GAP + 0.1 },
};
export const isSure = (m: { score: number; runnerUp: number; twin?: boolean } | null, r: Recogniser = "sface") => {
  if (!m) return false;
  const k = SURE_RAW[r];
  const top = unscaled(m.score, r), next = unscaled(m.runnerUp, r);
  return top >= k.sure - 1e-9 && top - next >= (m.twin ? k.twin : k.gap) - 1e-9;
};

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

type Loaded = { ort: Ort; detector: Session; recognizer: Session; sface?: Session; kind: Recogniser };
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
        // Two threads keep the app quick while faces are read in the background
        // (HUB_FACE_THREADS: the face test on its own machine uses more).
        const options = { logSeverityLevel: 3 as const, intraOpNumThreads: Number(process.env.HUB_FACE_THREADS) || 2 };
        const detector = await ort.InferenceSession.create(path.join(modelsDir, "face_detection_yunet_2023mar.onnx"), options);
        const sface = await ort.InferenceSession.create(path.join(modelsDir, "face_recognition_sface_2021dec.onnx"), options);
        if (auraFile) {
          const recognizer = await ort.InferenceSession.create(auraFile, options);
          return { ort, detector, recognizer, sface, kind: "both" as const };
        }
        return { ort, detector, recognizer: sface, kind: "sface" as const };
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
        out[ch * plane + v * 112 + u] = kind === "sface" ? value : (value - 127.5) / 127.5;
      }
    }
  }
  return out;
}

// The 112×112 face, left and right swapped.
export function mirror(t: Float32Array) {
  const o = new Float32Array(t.length);
  for (let c = 0; c < 3; c++)
    for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) o[c * 12544 + y * 112 + x] = t[c * 12544 + y * 112 + 111 - x];
  return o;
}

// AuraFace's and SFace's descriptions of one face, joined so that the
// cosine of two joined descriptions is 0.7 x AuraFace's + 0.3 x SFace's.
export function combine(aura: Float32Array, sface: Float32Array) {
  const a = unit(aura), b = unit(sface);
  const out = new Float32Array(a.length + b.length);
  const wa = Math.sqrt(BOTH_AURA), wb = Math.sqrt(1 - BOTH_AURA);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * wa;
  for (let i = 0; i < b.length; i++) out[a.length + i] = b[i] * wb;
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
export type FindOptions = {
  aura?: string | null;
  vision?: (jpeg: Buffer) => Promise<VisionFace[] | null>;
  // The face test only: "legacy" reads faces the way 0.11 did (from the
  // 2000 px copy, no second look); "variants" also returns those
  // descriptions next to the app's own, to compare them face by face.
  legacy?: boolean;
  variants?: ("v1" | "aa")[];
};

type Img = { data: Buffer; width: number; height: number };

// A rectangle cut out of a photo (black outside the photo).
export function cut(img: Img, x0: number, y0: number, w: number, h: number) {
  const out = Buffer.alloc(w * h * 3);
  const xa = Math.max(0, x0), xb = Math.min(img.width, x0 + w);
  if (xb <= xa) return out;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) {
    img.data.copy(out, ((y - y0) * w + (xa - x0)) * 3, (y * img.width + xa) * 3, (y * img.width + xb) * 3);
  }
  return out;
}

// A big face is made smaller properly before it is cut out at 112 px.
// Sampling a 600 px face straight down to 112 px skips most of its pixels
// and leaves speckle (aliasing) that the recognisers read as detail.
export async function shrinkForAlign(img: Img, landmarks: number[]): Promise<Img & { landmarks: number[] }> {
  const src = [0, 1, 2, 3, 4].map((i) => [landmarks[i * 2], landmarks[i * 2 + 1]]);
  const { a, b, tx, ty } = similarity(src, REFERENCE);
  const s = Math.hypot(a, b); // 112-px-face pixels per photo pixel
  if (!(s < 0.6) || !Number.isFinite(s) || s <= 0) return { ...img, landmarks };
  // Where the 112 px square sits in the photo.
  const det = a * a + b * b;
  const xs: number[] = [], ys: number[] = [];
  for (const [u, v] of [[0, 0], [112, 0], [0, 112], [112, 112]]) {
    xs.push((a * (u - tx) + b * (v - ty)) / det);
    ys.push((-b * (u - tx) + a * (v - ty)) / det);
  }
  const x0 = Math.floor(Math.min(...xs)) - 4, y0 = Math.floor(Math.min(...ys)) - 4;
  const w = Math.ceil(Math.max(...xs)) + 4 - x0, h = Math.ceil(Math.max(...ys)) + 4 - y0;
  if (w < 8 || h < 8 || w > 20000 || h > 20000) return { ...img, landmarks };
  const f = s / 0.9;
  const nw = Math.max(8, Math.round(w * f)), nh = Math.max(8, Math.round(h * f));
  const data = await sharp(cut(img, x0, y0, w, h), { raw: { width: w, height: h, channels: 3 } }).resize(nw, nh, { fit: "fill" }).raw().toBuffer();
  return { data, width: nw, height: nh, landmarks: landmarks.map((v, i) => (i % 2 ? (v - y0) * (nh / h) : (v - x0) * (nw / w))) };
}
export type VisionFace = { box: [number, number, number, number]; quality: number };

export async function findFaces(modelsDir: string, file: string | Buffer, o: FindOptions = {}): Promise<Face[] & { recogniser?: Recogniser }> {
  const { ort, detector, recognizer, sface, kind } = await loadModels(modelsDir, o.aura);
  // Analyse at up to 2000 px: big enough for small faces in a class photo.
  const { data: rgb, info } = await sharp(file, { failOn: "none" })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColourspace("srgb")
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
    const contain = Math.min(SIZE / Math.min(side, width - view.x), SIZE / Math.min(side, height - view.y));
    for (const f of await detect(ort, detector, crop)) {
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

  // Faces are found on the 2000 px copy; a photo from a good camera is three
  // times that. When a face is small on the copy, every face is read from
  // the original instead (up to HI_RES px), where it has nine times the detail.
  const copy: Img = { data: rgb, width, height };
  let hi: Img | null = null;
  if (!o.legacy && faces.some((f) => f.box[2] < HI_BELOW)) {
    try {
      const meta = await sharp(file, { failOn: "none" }).metadata();
      if (Math.max(meta.width ?? 0, meta.height ?? 0) > Math.max(width, height) * 1.15) {
        const r = await sharp(file, { failOn: "none" })
          .rotate()
          .resize({ width: HI_RES, height: HI_RES, fit: "inside", withoutEnlargement: true })
          .removeAlpha()
          .toColourspace("srgb")
          .raw()
          .toBuffer({ resolveWithObject: true });
        if (r.info.channels === 3) hi = { data: r.data, width: r.info.width, height: r.info.height };
      }
    } catch {
      hi = null; // the copy is still there
    }
  }
  const src = hi ?? copy;
  const K = src.width / width;

  const describe = async (t: Float32Array, s: Session = recognizer) =>
    Float32Array.from((await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, 112, 112]) }))[s.outputNames[0]].data as Float32Array);
  const embed = async (im: Img, lm: number[]) => {
    const aligned = align(im.data, im.width, im.height, lm, kind);
    let raw = await describe(aligned);
    // AuraFace also looks at the mirror image of the face and adds the two:
    // steadier descriptions, so more faces are named by themselves (face test:
    // 63% -> 70% with 3 confirmed faces each, still none wrong).
    if (kind !== "sface") {
      const m = await describe(mirror(aligned));
      raw = raw.map((v, i) => v + m[i]);
    }
    const embedding = kind === "both" && sface ? combine(raw, await describe(align(im.data, im.width, im.height, lm, "sface"), sface)) : unit(raw);
    return { aligned, embedding };
  };

  const result: Face[] = [];
  for (const f of faces) {
    const boxS = f.box.map((v) => v * K);
    let lm = f.landmarks.map((v) => v * K);
    // A second, closer look at just this face places the eyes, nose and
    // mouth more exactly than the look at the whole photo could.
    let zoomScore: number | null | undefined;
    if (!o.legacy) {
      const z = await secondLook(ort, detector, src, boxS).catch(() => null);
      zoomScore = z?.score ?? null;
      if (z) lm = z.landmarks;
    }
    const ready = o.legacy ? { ...src, landmarks: lm } : await shrinkForAlign(src, lm);
    const { aligned, embedding } = await embed(ready, ready.landmarks);
    let variants: Record<string, Float32Array> | undefined;
    if (o.variants?.length) {
      variants = {};
      if (o.variants.includes("v1")) variants.v1 = (await embed(copy, f.landmarks)).embedding;
      if (o.variants.includes("aa")) {
        const r = await shrinkForAlign(copy, f.landmarks);
        variants.aa = (await embed(r, r.landmarks)).embedding;
      }
    }
    const [x, y, w, h] = f.box;
    const box: Face["box"] = [clamp(x / width), clamp(y / height), clamp(w / width), clamp(h / height)];
    const sharpness = faceSharpness(aligned, kind);
    let why = faceProblem({ box: boxS, score: f.score, landmarks: lm }, sharpness, src.width, src.height);
    if (!why && vision) {
      const v = vision.find((vf) => iou(vf.box, box) > 0.25 || inside(box, vf.box));
      // Vision looks at a 1600 px copy and misses small faces at the back of
      // a class photo: only a face big enough for it to see is ruled out
      // because it saw nothing there (B-86).
      if (!v && visionCanSee(box, width, height)) why = "not-a-face";
      else if (v && v.quality < 0.12) why = "blurred";
    }
    result.push({ box, score: f.score, landmarks: lm.map((v) => v / K), embedding, usable: !why, why, sharpness, px: boxS[2], detScore: f.score, zoomScore, variants });
  }
  return Object.assign(result, { recogniser: kind });
}

// Below this width on the 2000 px copy a face gains from the original.
const HI_BELOW = 160;

// The face finder on one 640 x 640 picture (RGB bytes).
async function detect(ort: Ort, detector: Session, crop: Buffer, threshold = SCORE) {
  // YuNet takes BGR, 0-255, channels first.
  const input = new Float32Array(3 * SIZE * SIZE);
  const plane = SIZE * SIZE;
  for (let i = 0; i < plane; i++) {
    input[i] = crop[i * 3 + 2];
    input[plane + i] = crop[i * 3 + 1];
    input[2 * plane + i] = crop[i * 3];
  }
  const out = await detector.run({ input: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  return decode(out as never, SIZE, threshold);
}

// The face finder again, on a square around one face (the face fills a
// little under half of it): its eyes, nose and mouth in the photo's pixels,
// or null when it sees no face there.
export async function secondLook(ort: Ort, detector: Session, img: Img, box: number[]): Promise<Raw | null> {
  const [x, y, w, h] = box;
  const side = Math.max(32, Math.round(Math.max(w, h) * 2.2));
  const x0 = Math.round(x + w / 2 - side / 2), y0 = Math.round(y + h / 2 - side / 2);
  const crop = await sharp(cut(img, x0, y0, side, side), { raw: { width: side, height: side, channels: 3 } }).resize(SIZE, SIZE, { fit: "fill" }).raw().toBuffer();
  const k = side / SIZE;
  let best: Raw | null = null, bi = 0.3;
  for (const f of await detect(ort, detector, crop, 0.3)) {
    const b = [f.box[0] * k + x0, f.box[1] * k + y0, f.box[2] * k, f.box[3] * k];
    const v = iou(b, box);
    if (v > bi) [best, bi] = [{ score: f.score, box: b, landmarks: f.landmarks.map((p, i) => p * k + (i % 2 ? y0 : x0)) }, v];
  }
  return best;
}

// Is a face big enough that Apple Vision, looking at the 1600 px copy,
// would surely have seen it?
export const VISION_MIN_PX = 80;
export function visionCanSee(box: number[], width: number, height: number) {
  const k = Math.min(1, 1600 / Math.max(width, height));
  return box[2] * width * k >= VISION_MIN_PX && box[3] * height * k >= VISION_MIN_PX;
}

// How crisp the face itself is: variance of the Laplacian on the aligned
// 112 px face (grey). A face in the blurred background scores low.
export function faceSharpness(aligned: Float32Array, kind: Recogniser = "sface") {
  const plane = 112 * 112;
  const grey = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    const v = (aligned[i] + aligned[plane + i] + aligned[2 * plane + i]) / 3;
    grey[i] = kind === "sface" ? v : v * 127.5 + 127.5;
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
// The face finder's own confidence below which a face is "unsure".
export const UNSURE_SCORE = 0.86;
export function faceProblem(f: { box: number[]; score: number; landmarks: number[] }, sharpness: number, width: number, height: number, o: { minScore?: number } = {}): string | null {
  const [x, y, w, h] = f.box;
  const lm = f.landmarks;
  if (w < 40 || h < 40) return "too-small";
  if (f.score < (o.minScore ?? UNSURE_SCORE)) return "unsure";
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

export type Known = { studentId: string; embedding: Float32Array; className?: string | null; kind?: string | null; gender?: string | null; at?: string | null; penalty?: number; learned?: boolean; photoId?: number };
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

// Learning from its own sure names: a face the app named by itself, very
// close to that student (raw score >= LEARN_ADD), becomes an extra example of
// them ("learned", kept apart from the faces people named). A name that
// rests on learned examples is only given when the faces people named agree
// on their own: same student first, raw score >= LEARN_HAND, a small lead.
// Face test, class of 30: 82% -> 88% named by themselves with 3 confirmed
// faces each (88% -> 91% with 5), none wrong (6 Nov 2026).
export const LEARN_ADD = 0.5;
export const LEARN_HAND = 0.35;
export const LEARN_LEAD = 0.02;
export function learnFrom(raw: number) {
  return raw >= LEARN_ADD;
}
export function handAgrees(embedding: Float32Array, known: Known[], studentId: string, r: Recogniser = "sface") {
  if (!known.some((k) => k.learned)) return true;
  const own = ranked(embedding, known.filter((k) => !k.learned), r);
  if (!own.length || own[0].studentId !== studentId) return false;
  const top = unscaled(own[0].score, r), next = own[1] ? unscaled(own[1].score, r) : -1;
  return top >= LEARN_HAND - 1e-9 && top - next >= LEARN_LEAD - 1e-9;
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
//
// The same rule sharpens each match's lead: the "next most likely person"
// for a face can't be someone a person already named in this photo, or
// someone another face in it is surely (a stronger, sure match). In a class
// photo most of the class is ruled out this way, so more faces are named by
// themselves. Twins and look-alikes ("careful") are never ruled out.
export type AssignOptions = { plain?: boolean; careful?: (studentId: string) => boolean };
export function assignPhoto(embeddings: (Float32Array | null)[], known: Known[], r: Recogniser = "sface", taken: Set<string> = new Set(), allowed?: (face: number, studentId: string) => boolean, o: AssignOptions = {}): (Match | null)[] {
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
  if (o.plain) return out;
  // Who is surely somewhere else in this photo, judged on the plain leads.
  const held = new Map<string, { face: number; score: number }>();
  out.forEach((m, face) => m && isSure(m, r) && held.set(m.studentId, { face, score: m.score }));
  out.forEach((m, face) => {
    if (!m) return;
    const next = lists[face].find((c) => {
      if (c.studentId === m.studentId) return false;
      if (o.careful?.(c.studentId) || o.careful?.(m.studentId)) return true;
      if (taken.has(c.studentId)) return false;
      const h = held.get(c.studentId);
      return !(h && h.face !== face && h.score > c.score);
    });
    m.runnerUp = next?.score ?? 0;
  });
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
