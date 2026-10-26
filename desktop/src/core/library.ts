import path from "node:path";

// How the school's photo library folder is laid out:
//   <library>/<school year>/<term>/<YYYY-MM-DD Event name>/<photo>
// for example  Photos/2026-2027/Term 1/2026-10-20 Science fair/IMG_0001.jpg
// Originals never leave this folder; only small web copies are uploaded.

export const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"];

export function isPhoto(file: string) {
  const name = path.basename(file);
  return !name.startsWith(".") && PHOTO_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

// School years run September to August, with term 2 from February.
export function schoolYear(date: Date) {
  const y = date.getFullYear();
  return date.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function term(date: Date) {
  const m = date.getMonth();
  return m >= 8 || m === 0 ? "Term 1" : "Term 2";
}

export function isoDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Folder names can't hold some characters on Windows.
export function safeName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Event";
}

export function eventFolder(library: string, date: Date, eventName: string) {
  return path.join(library, schoolYear(date), term(date), `${isoDate(date)} ${safeName(eventName)}`);
}

export type FolderEvent = { key: string; title: string; date: string | null };

// The event a photo belongs to is its folder. A leading date in the folder
// name becomes the event date. Photos straight in the library root, or in
// the year and term folders, have no event.
export function eventFromPath(library: string, file: string): FolderEvent | null {
  const rel = path.relative(library, path.dirname(file));
  if (!rel || rel.startsWith("..")) return null;
  const parts = rel.split(path.sep);
  const last = parts[parts.length - 1];
  if (/^\d{4}-\d{4}$/.test(last) || /^term \d$/i.test(last)) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[\s_-]+(.+)$/.exec(last);
  return {
    key: parts.join("/"),
    title: (match ? match[2] : last).trim().slice(0, 120),
    date: match ? match[1] : null,
  };
}
