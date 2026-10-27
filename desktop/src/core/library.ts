import path from "node:path";

// How the school's photo library folder is laid out:
//   <library>/<school year>/<term>/<YYYY-MM-DD Event name>/<photo>
// for example  Photos/2026-2027/Term 1/2026-10-20 Science fair/IMG_0001.jpg
// Originals never leave this folder; only small web copies are uploaded.

export const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".heif"];
// Camera RAW files are shown from the full-size preview the camera saves inside them.
export const RAW_EXTENSIONS = [".cr2", ".cr3", ".nef", ".nrw", ".arw", ".srf", ".dng", ".raf", ".orf", ".rw2", ".pef", ".srw"];

export function isRaw(file: string) {
  return RAW_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

export function isPhoto(file: string) {
  const name = path.basename(file);
  return !name.startsWith(".") && PHOTO_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

export function isLibraryFile(file: string) {
  return isPhoto(file) || (!path.basename(file).startsWith(".") && isRaw(file));
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
// In the usual layout a folder under the event is a class:
//   2026-2027/Term 1/2026-10-20 Science fair/4B/IMG_0001.jpg
export function eventFromPath(library: string, file: string): FolderEvent | null {
  return placeFromPath(library, file).event;
}

const YEAR = /^\d{4}-\d{4}$/;
const TERM = /^term \d$/i;

export type Place = { year: string | null; term: string | null; event: FolderEvent | null; className: string | null };

export function placeFromPath(library: string, file: string): Place {
  const rel = path.relative(library, path.dirname(file));
  const none: Place = { year: null, term: null, event: null, className: null };
  if (!rel || rel.startsWith("..")) return none;
  const parts = rel.split(path.sep).filter((p) => p && p !== ".");
  let i = 0;
  const year = YEAR.test(parts[i] ?? "") ? parts[i++] : null;
  const termName = TERM.test(parts[i] ?? "") ? parts[i++] : null;
  if (i >= parts.length) return { ...none, year, term: termName };
  // Without year and term folders, the deepest folder is the event.
  const structured = year !== null;
  const eventIndex = structured ? i : parts.length - 1;
  const name = parts[eventIndex];
  const match = /^(\d{4}-\d{2}-\d{2})[\s_-]+(.+)$/.exec(name);
  const className = structured && parts.length > eventIndex + 1 ? parts.slice(eventIndex + 1).join(" / ").slice(0, 60) : null;
  return {
    year,
    term: termName,
    className,
    event: {
      key: parts.slice(0, eventIndex + 1).join("/"),
      title: (match ? match[2] : name).trim().slice(0, 120),
      date: match ? match[1] : null,
    },
  };
}
