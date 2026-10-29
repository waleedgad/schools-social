import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import exifr from "exifr";
import sharp from "sharp";
import { source } from "./media";

export type Prepared = { full: Buffer; thumb: Buffer; width: number; height: number; takenAt: Date | null };

// A web copy (2048 px) and a thumbnail (480 px). sharp drops all metadata
// unless asked to keep it, so GPS location never leaves the school.
// Faces of people who can't appear (boxes as fractions of the photo) can be
// blurred in the web copy; the original at school is never changed.
export async function prepare(file: string, blur: [number, number, number, number][] = []): Promise<Prepared> {
  let base = sharp(await source(file), { failOn: "error" }).rotate();
  if (blur.length) {
    const sized = await base.resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
    const W = sized.info.width, H = sized.info.height;
    const parts = [];
    for (const [x, y, w, h] of blur) {
      // A little bigger than the face so hair and edges are covered too.
      const left = Math.max(0, Math.floor((x - w * 0.2) * W)), top = Math.max(0, Math.floor((y - h * 0.25) * H));
      const width = Math.min(W - left, Math.ceil(w * 1.4 * W)), height = Math.min(H - top, Math.ceil(h * 1.5 * H));
      if (width < 4 || height < 4) continue;
      const input = await sharp(sized.data).extract({ left, top, width, height }).resize(Math.max(2, Math.round(width / 24)), Math.max(2, Math.round(height / 24))).resize(width, height, { kernel: "cubic" }).blur(Math.max(2, width / 14)).toBuffer();
      parts.push({ input, left, top });
    }
    base = sharp(await sharp(sized.data).composite(parts).jpeg({ quality: 95 }).toBuffer());
  }
  const full = await base
    .clone()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base
    .clone()
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height, takenAt: await takenAt(file) };
}

export async function takenAt(file: string): Promise<Date | null> {
  try {
    const tags = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
    const d = tags?.DateTimeOriginal ?? tags?.CreateDate;
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

// The same photo copied to two folders is still one photo.
export function fileHash(file: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}
