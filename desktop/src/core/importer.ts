import { createHash } from "node:crypto";
import { constants, createReadStream, existsSync } from "node:fs";
import { copyFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { rawPreview } from "./media";

// The parts of importing that don't need the app: reading a card, splitting
// it into events, spotting junk shots and bursts, and copying safely.

export type SourceFile = {
  file: string;
  size: number;
  // Taken time in ms, as the camera wrote it (before any clock fix).
  taken: number;
  camera: string;
  // Name + size + time: the same photo on the same card, without reading it all.
  key: string;
  raw: boolean;
  video: boolean;
};

const RAW = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|srw|pef)$/i;
const VIDEO = /\.(mp4|mov|m4v|avi|mts|3gp)$/i;

export async function readSource(file: string): Promise<SourceFile> {
  const s = await stat(file);
  let taken = s.mtimeMs;
  let camera = "";
  if (!VIDEO.test(file)) {
    try {
      const { default: exifr } = await import("exifr");
      const t = await exifr.parse(file, ["DateTimeOriginal", "CreateDate", "Make", "Model"]);
      const d = t?.DateTimeOriginal ?? t?.CreateDate;
      if (d instanceof Date && !Number.isNaN(d.getTime())) taken = d.getTime();
      camera = [t?.Make, t?.Model].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      // "Canon Canon EOS R6" -> "Canon EOS R6"
      const [first, ...rest] = camera.split(" ");
      if (rest.join(" ").toLowerCase().startsWith(first.toLowerCase())) camera = rest.join(" ");
    } catch {
      // no camera information
    }
  }
  return { file, size: s.size, taken, camera, key: `${path.basename(file).toLowerCase()}|${s.size}|${Math.round(taken / 1000)}`, raw: RAW.test(file), video: VIDEO.test(file) };
}

export const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// A card from a week of school holds several events. A new event starts on
// a new day or after a gap of `gapHours` with no photos.
export function splitByGaps<T extends { taken: number }>(files: T[], gapHours: number): T[][] {
  const sorted = [...files].sort((a, b) => a.taken - b.taken);
  const groups: T[][] = [];
  for (const f of sorted) {
    const last = groups.at(-1)?.at(-1);
    if (!last || day(last.taken) !== day(f.taken) || f.taken - last.taken > gapHours * 3600_000) groups.push([f]);
    else groups.at(-1)!.push(f);
  }
  return groups;
}

// Shots fired within a second of each other on the same camera are one burst.
export function bursts<T extends { taken: number; camera: string; file: string }>(files: T[]): T[][] {
  const sorted = [...files].sort((a, b) => a.taken - b.taken || a.file.localeCompare(b.file));
  const out: T[][] = [];
  for (const f of sorted) {
    const g = out.at(-1);
    const last = g?.at(-1);
    if (g && last && last.camera === f.camera && f.taken - last.taken <= 1000) g.push(f);
    else out.push([f]);
  }
  return out.filter((g) => g.length > 1);
}

export type Look = { brightness: number; sharpness: number; spread: number };

// A small picture for the preview grid, and how it looks: pocket shots are
// almost black, blank shots almost white or one flat colour, and very blurry
// shots have no edges at all.
export async function lookAt(file: string, thumb: string): Promise<Look | null> {
  try {
    const input = RAW.test(file) ? (await rawPreview(file)) ?? file : file;
    const img = sharp(input, { failOn: "none" }).rotate();
    await img.clone().resize({ width: 360, height: 360, fit: "inside" }).jpeg({ quality: 72 }).toFile(thumb);
    const { data, info } = await img.clone().resize({ width: 200, height: 200, fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    let light = 0, light2 = 0, lap = 0, lap2 = 0, n = 0;
    for (let i = 0; i < data.length; i++) {
      light += data[i];
      light2 += data[i] * data[i];
    }
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
        lap += v;
        lap2 += v * v;
        n++;
      }
    const mean = light / data.length;
    return { brightness: mean / 255, spread: Math.sqrt(Math.max(0, light2 / data.length - mean * mean)) / 255, sharpness: n ? lap2 / n - (lap / n) ** 2 : 0 };
  } catch {
    return null;
  }
}

export function junkReason(l: Look | null): "dark" | "blank" | "blurry" | null {
  if (!l) return null;
  if (l.brightness < 0.05) return "dark";
  if (l.spread < 0.025 || l.brightness > 0.97) return "blank";
  if (l.sharpness < 4) return "blurry";
  return null;
}

export type CalendarItem = { name: string; start: string; end: string };

// The event that day in the school calendar, if there is one (holidays and
// terms are left out: nobody names photos "Term 1").
export function calendarName(date: string, calendar: CalendarItem[]) {
  const hit = calendar.find((c) => c.name && c.start && c.start <= date && (c.end || c.start) >= date && !/term|semester|فصل|ترم|holiday|vacation|break|عطلة|إجازة/i.test(c.name));
  return hit?.name ?? "";
}

export async function hashFile(file: string) {
  const h = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve()).on("error", reject);
  });
  return h.digest("hex");
}

// Copies next to the target first, checks every byte arrived, then puts it
// in place. A copy that doesn't match is removed and reported.
export async function copyVerified(src: string, dest: string, srcHash?: string) {
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.copying`);
  await copyFile(src, tmp, constants.COPYFILE_EXCL).catch(async (e) => {
    if (existsSync(tmp)) {
      await rm(tmp, { force: true });
      await copyFile(src, tmp, constants.COPYFILE_EXCL);
    } else throw e;
  });
  const [a, b] = await Promise.all([srcHash ?? hashFile(src), hashFile(tmp)]);
  if (a !== b) {
    await rm(tmp, { force: true });
    throw new Error("copy-check-failed");
  }
  await rename(tmp, dest);
  return a;
}

// Most students recognised in an import from one class: that's the class.
export function likelyClass(classes: (string | null)[]) {
  const counts = new Map<string, number>();
  for (const c of classes) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  const total = classes.filter(Boolean).length;
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return best && n >= 3 && n / total >= 0.6 ? { className: best, share: n / total, faces: n } : null;
}

// Google Drive and OneDrive share links, read without an account.
export function linkKind(url: string): { kind: "gdrive-folder" | "gdrive-file" | "onedrive"; id: string } | null {
  let m = /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=)([\w-]{10,})/.exec(url);
  if (m) return { kind: "gdrive-folder", id: m[1] };
  m = /drive\.google\.com\/(?:file\/d\/|uc\?(?:export=\w+&)?id=)([\w-]{10,})/.exec(url);
  if (m) return { kind: "gdrive-file", id: m[1] };
  if (/(1drv\.ms|onedrive\.live\.com|sharepoint\.com)\//i.test(url)) return { kind: "onedrive", id: url.trim() };
  return null;
}

// The public folder page lists each file as an "entry" with its title.
export function parseDriveFolder(html: string) {
  const out: { id: string; name: string; folder: boolean }[] = [];
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ id: m[1], name: decode(m[3]), folder: /\/folders\//.test(m[2]) });
  return out;
}
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// OneDrive's share API takes the link itself, encoded.
export const oneDriveShareId = (url: string) => "u!" + Buffer.from(url.trim()).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
