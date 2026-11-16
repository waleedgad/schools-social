import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// What a face is doing: eyes open or closed, smiling, turned away. Used to
// pick the best photos (nobody blinking, people looking at the camera).
// Two small models from Google's MediaPipe Face Landmarker (Apache 2.0, free
// for commercial use; see models/README.md), run with ONNX Runtime like the
// other face models, so they give the same answer on Mac and Windows:
//   face_landmarks_detector  478 points on one face (256 x 256 picture)
//   face_blendshapes         52 expression strengths from 146 of the points
// Nothing here leaves the computer.

type Ort = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;
type Img = { data: Buffer; width: number; height: number };

export const MESH_FILE = "face_landmarks_detector.onnx";
export const SHAPES_FILE = "face_blendshapes.onnx";

export type Expression = {
  // 0 (wide open) to 1 (shut): the more open of the two eyes, so a wink or
  // one eye behind hair doesn't count as closed.
  blink: number;
  // 0 to 1, from the mouth corners.
  smile: number;
  // 0 (facing the camera) to 1 (side-on), and the side: -1 left, 1 right.
  turn: number;
  // 0 to 1: looking down (at a book, the floor).
  down: number;
  // How sure the model is that there is a face in the picture it was given.
  presence: number;
  // Eye opening measured on the points themselves (height over width of the
  // eye, the more open eye): a second opinion next to blink.
  ear: number;
};

// The 146 points the expression model reads (MediaPipe face_blendshapes_graph.cc).
const SUBSET = [
  0, 1, 4, 5, 6, 7, 8, 10, 13, 14, 17, 21, 33, 37, 39, 40, 46, 52, 53, 54, 55, 58, 61, 63, 65, 66, 67, 70, 78, 80, 81, 82, 84, 87, 88, 91, 93, 95, 103, 105, 107, 109, 127, 132, 133, 136, 144, 145, 146, 148, 149, 150, 152, 153, 154, 155, 157, 158, 159, 160,
  161, 162, 163, 168, 172, 173, 176, 178, 181, 185, 191, 195, 197, 234, 246, 249, 251, 263, 267, 269, 270, 276, 282, 283, 284, 285, 288, 291, 293, 295, 296, 297, 300, 308, 310, 311, 312, 314, 317, 318, 321, 323, 324, 332, 334, 336, 338, 356, 361, 362, 365,
  373, 374, 375, 377, 378, 379, 380, 381, 382, 384, 385, 386, 387, 388, 389, 390, 397, 398, 400, 402, 405, 409, 415, 454, 466, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477,
];
// Places in the expression model's answer.
const BLINK_L = 9, BLINK_R = 10, LOOK_DOWN_L = 11, LOOK_DOWN_R = 12, SMILE_L = 44, SMILE_R = 45;

export type ExpressionModels = { mesh: Session; shapes: Session };
const loaded = new Map<string, Promise<ExpressionModels | null>>();

// The two models, or null when they are not in the models folder (an app
// folder from before they were added): picking then works without them.
export function loadExpression(ort: Ort, modelsDir: string) {
  if (!loaded.has(modelsDir)) {
    loaded.set(
      modelsDir,
      (async () => {
        const mesh = path.join(modelsDir, MESH_FILE), shapes = path.join(modelsDir, SHAPES_FILE);
        if (!existsSync(mesh) || !existsSync(shapes)) return null;
        const options = { logSeverityLevel: 3 as const, intraOpNumThreads: Number(process.env.HUB_FACE_THREADS) || 2 };
        try {
          return { mesh: await ort.InferenceSession.create(mesh, options), shapes: await ort.InferenceSession.create(shapes, options) };
        } catch {
          return null;
        }
      })(),
    );
  }
  return loaded.get(modelsDir)!;
}

const SIDE = 256;

// The face, upright, in a 256 px square with room around it (the square is
// 1.5 times the face box, as the model was trained), as numbers 0 to 1.
export async function faceSquare(img: Img, box: number[], landmarks: number[]) {
  const [x, y, w, h] = box;
  // Level the eyes. The two eye points come first; which is which doesn't matter.
  const [ax, ay, bx, by] = landmarks[0] <= landmarks[2] ? landmarks : [landmarks[2], landmarks[3], landmarks[0], landmarks[1]];
  let angle = Math.atan2(by - ay, bx - ax);
  if (!Number.isFinite(angle) || Math.abs(angle) > 1.2) angle = 0;
  const side = Math.max(w, h) * 1.5;
  const cx = x + w / 2, cy = y + h / 2;
  // A bigger, unrotated patch around the face, made the right size smoothly;
  // the upright square is then read out of it.
  const patch = Math.max(8, Math.ceil(side * 1.45));
  const x0 = Math.round(cx - patch / 2), y0 = Math.round(cy - patch / 2);
  const scale = SIDE / side;
  const ps = Math.max(8, Math.round(patch * scale));
  const data = await sharp(cutOut(img, x0, y0, patch, patch), { raw: { width: patch, height: patch, channels: 3 } }).resize(ps, ps, { fit: "fill" }).raw().toBuffer();
  const k = ps / patch;
  const out = new Float32Array(SIDE * SIDE * 3);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const mid = ps / 2;
  for (let v = 0; v < SIDE; v++) {
    for (let u = 0; u < SIDE; u++) {
      const dx = u - SIDE / 2 + 0.5, dy = v - SIDE / 2 + 0.5;
      const sx = mid + (dx * cos - dy * sin) * (k / scale) - 0.5, sy = mid + (dx * sin + dy * cos) * (k / scale) - 0.5;
      const xa = Math.floor(sx), ya = Math.floor(sy), fx = sx - xa, fy = sy - ya;
      for (let c = 0; c < 3; c++) {
        const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= ps || yy >= ps ? 0 : data[(yy * ps + xx) * 3 + c]);
        out[(v * SIDE + u) * 3 + c] = (at(xa, ya) * (1 - fx) * (1 - fy) + at(xa + 1, ya) * fx * (1 - fy) + at(xa, ya + 1) * (1 - fx) * fy + at(xa + 1, ya + 1) * fx * fy) / 255;
      }
    }
  }
  return out;
}

function cutOut(img: Img, x0: number, y0: number, w: number, h: number) {
  const out = Buffer.alloc(w * h * 3);
  const xa = Math.max(0, x0), xb = Math.min(img.width, x0 + w);
  if (xb <= xa) return out;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) {
    img.data.copy(out, ((y - y0) * w + (xa - x0)) * 3, (y * img.width + xa) * 3, (y * img.width + xb) * 3);
  }
  return out;
}

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Eye opening from six points around an eye: height over width.
function eyeRatio(p: Float32Array, i: number[]) {
  const d = (a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1]);
  const wide = d(i[0], i[3]);
  return wide > 0 ? (d(i[1], i[5]) + d(i[2], i[4])) / (2 * wide) : 0;
}

// The expression read from the model's 478 points and 52 strengths.
export function expressionOf(points: Float32Array, shapes: Float32Array, presence: number): Expression {
  const px = (i: number) => points[i * 3];
  // The nose tip between the two sides of the face: in the middle when the
  // face looks at the camera.
  const left = Math.abs(px(1) - px(234)), right = Math.abs(px(454) - px(1));
  const side = left + right > 0 ? (left - right) / (left + right) : 0;
  return {
    blink: clamp01(Math.min(shapes[BLINK_L], shapes[BLINK_R])),
    smile: clamp01((shapes[SMILE_L] + shapes[SMILE_R]) / 2),
    turn: clamp01(Math.abs(side)),
    down: clamp01((shapes[LOOK_DOWN_L] + shapes[LOOK_DOWN_R]) / 2),
    presence,
    ear: Math.max(eyeRatio(points, [33, 160, 158, 133, 153, 144]), eyeRatio(points, [362, 385, 387, 263, 373, 380])),
  };
}

// box and landmarks in the pixels of img. Null when the model sees no face
// in the square (a hand, a face the finder got wrong).
export async function readExpression(ort: Ort, m: ExpressionModels, img: Img, box: number[], landmarks: number[]): Promise<Expression | null> {
  const input = await faceSquare(img, box, landmarks);
  const out = await m.mesh.run({ [m.mesh.inputNames[0]]: new ort.Tensor("float32", input, [1, SIDE, SIDE, 3]) });
  let points: Float32Array | null = null, presence = 0;
  for (const name of m.mesh.outputNames) {
    const d = out[name].data as Float32Array;
    if (d.length === 1434) points = d;
    else if (out[name].dims.length === 4 && d.length === 1) presence = sigmoid(d[0]);
  }
  if (!points) return null;
  const sub = new Float32Array(SUBSET.length * 2);
  SUBSET.forEach((p, i) => {
    sub[i * 2] = points![p * 3];
    sub[i * 2 + 1] = points![p * 3 + 1];
  });
  const res = await m.shapes.run({ [m.shapes.inputNames[0]]: new ort.Tensor("float32", sub, [1, SUBSET.length, 2]) });
  const shapes = res[m.shapes.outputNames[0]].data as Float32Array;
  return expressionOf(points, shapes, presence);
}
