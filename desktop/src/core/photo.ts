import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import exifr from "exifr";
import sharp from "sharp";

export type Prepared = { full: Buffer; thumb: Buffer; width: number; height: number; takenAt: Date | null };

// A web copy (2048 px) and a thumbnail (480 px). sharp drops all metadata
// unless asked to keep it, so GPS location never leaves the school.
export async function prepare(file: string): Promise<Prepared> {
  const base = sharp(file, { failOn: "error" }).rotate();
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
