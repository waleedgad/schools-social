import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { isRaw } from "./library";

// Reading photos for the screen: thumbnails, large previews, a quality
// score and a fingerprint for spotting near-identical shots.

// A RAW file carries the camera's own full-size JPEG preview. Find every
// JPEG inside the file and keep the largest one sharp can read.
export async function rawPreview(file: string): Promise<Buffer> {
  const buf = await readFile(file);
  let best: { at: number; pixels: number } | null = null;
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] !== 0xff || buf[i + 1] !== 0xd8 || buf[i + 2] !== 0xff) continue;
    const marker = buf[i + 3];
    if (marker !== 0xe0 && marker !== 0xe1 && marker !== 0xdb && marker !== 0xc4 && marker !== 0xc0) continue;
    try {
      const m = await sharp(buf.subarray(i), { failOn: "none" }).metadata();
      const pixels = (m.width ?? 0) * (m.height ?? 0);
      if (m.format === "jpeg" && pixels > (best?.pixels ?? 0)) best = { at: i, pixels };
    } catch {
      // not a readable JPEG; keep looking
    }
  }
  if (!best) throw new Error("No preview inside this RAW file");
  return buf.subarray(best.at);
}

// iPhone HEIC photos: sharp can't decode them, but every Mac can, with sips.
async function heicToJpeg(file: string): Promise<Buffer> {
  const { execFile } = await import("node:child_process");
  const { mkdtemp, readFile: read, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "hub-heic-"));
  const out = path.join(dir, "photo.jpg");
  try {
    await new Promise<void>((resolve, reject) =>
      execFile("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", file, "--out", out], (e) => (e ? reject(e) : resolve())),
    );
    return await read(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// What sharp should open: the file itself, a RAW file's preview, or a HEIC converted.
export async function source(file: string): Promise<string | Buffer> {
  if (isRaw(file)) return rawPreview(file);
  if (/\.hei[cf]$/i.test(file)) return heicToJpeg(file);
  return file;
}

export async function makeThumb(input: string | Buffer, out: string, size: number) {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: size > 1000 ? 86 : 78 })
    .toFile(out);
}

export type Quality = { sharpness: number; brightness: number; dhash: string; quality: number };

// Sharpness: how strong the fine edges are (variance of the Laplacian) on a
// 512 px greyscale copy. Brightness: the average level. Both feed one score
// from 0 to 10 used for "best photos" picks, with faces added later.
export async function measure(input: string | Buffer): Promise<Quality> {
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 512, height: 512, fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  let sum = 0, sum2 = 0, n = 0, light = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  for (let i = 0; i < data.length; i++) light += data[i];
  const variance = sum2 / n - (sum / n) ** 2;
  const brightness = light / data.length / 255;

  const small = await sharp(input, { failOn: "none" }).rotate().resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += small[y * 9 + x] > small[y * 9 + x + 1] ? "1" : "0";
  const dhash = BigInt(`0b${bits}`).toString(16).padStart(16, "0");

  return { sharpness: variance, brightness, dhash, quality: score(variance, brightness, 0, 0) };
}

// 0-10: sharp and well exposed first, then faces that are big enough to see.
export function score(sharpness: number, brightness: number, faces: number, biggestFace: number) {
  const sharp = Math.min(1, Math.log10(1 + sharpness) / 3); // ~1000 is crisp
  const exposure = 1 - Math.min(1, Math.abs(brightness - 0.5) * 2.2);
  const people = faces ? Math.min(1, 0.5 + biggestFace * 3) : 0.35;
  return Math.round((sharp * 5 + exposure * 2.5 + people * 2.5) * 10) / 10;
}

export function hamming(a: string, b: string) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
