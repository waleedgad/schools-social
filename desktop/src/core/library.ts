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

// The school's own term dates (Settings → School calendar, shared with the
// website). Without them: school years run September to August, with
// term 2 from February.
export type TermDates = { name: string; start: string; end: string };
let TERMS: TermDates[] = [];
export function setTermDates(list: TermDates[]) {
  TERMS = (list ?? []).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.start) && /^\d{4}-\d{2}-\d{2}$/.test(t.end)).sort((a, b) => a.start.localeCompare(b.start));
}

// A term starting from July on opens a school year; earlier ones belong to
// the year that started the summer before.
const yearOfTerm = (t: TermDates) => {
  const y = Number(t.start.slice(0, 4));
  return Number(t.start.slice(5, 7)) >= 7 ? y : y - 1;
};

// The term a day is in, or during a holiday the term that started last in
// the same school year.
function termFor(date: Date) {
  const d = isoDate(date);
  const inside = TERMS.find((t) => d >= t.start && d <= t.end);
  if (inside) return inside;
  const last = TERMS.filter((t) => t.start <= d).at(-1);
  const next = TERMS.find((t) => t.start > d);
  if (last && next && yearOfTerm(last) === yearOfTerm(next)) return last;
  return null;
}

export function schoolYear(date: Date) {
  const t = termFor(date);
  if (t) return `${yearOfTerm(t)}-${yearOfTerm(t) + 1}`;
  const y = date.getFullYear();
  return date.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function term(date: Date) {
  const t = termFor(date);
  if (t) return `Term ${TERMS.filter((x) => yearOfTerm(x) === yearOfTerm(t)).indexOf(t) + 1}`;
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
// Term folders as schools name them: "Term 1", "Semester 2", "T3", and in
// Arabic "الفصل الأول", "الفصل الدراسي الثاني", "الترم 3", "الفصل ١".
// All are read as "Term N" so the sidebar and term dates line up.
const ORDINAL: Record<string, number> = { "الأول": 1, "الاول": 1, "أول": 1, "الثاني": 2, "ثاني": 2, "الثالث": 3, "ثالث": 3 };
export function termNumber(folder: string): number | null {
  const f = folder.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\s+/g, " ");
  const en = /^(?:term|semester|trimester|t)\s?([1-4])$/i.exec(f);
  if (en) return Number(en[1]);
  const ar = /^(?:ال)?(?:فصل|ترم)(?: الدراسي)? (\S+)$/.exec(f);
  if (!ar) return null;
  if (/^[1-4]$/.test(ar[1])) return Number(ar[1]);
  return ORDINAL[ar[1]] ?? null;
}

export type Place = { year: string | null; term: string | null; event: FolderEvent | null; className: string | null };

export function placeFromPath(library: string, file: string): Place {
  const rel = path.relative(library, path.dirname(file));
  const none: Place = { year: null, term: null, event: null, className: null };
  if (!rel || rel.startsWith("..")) return none;
  const parts = rel.split(path.sep).filter((p) => p && p !== ".");
  let i = 0;
  const year = YEAR.test(parts[i] ?? "") ? parts[i++] : null;
  const tn = termNumber(parts[i] ?? "");
  const termName = tn ? (i++, `Term ${tn}`) : null;
  if (i >= parts.length) return { ...none, year, term: termName };
  // Without year and term folders, the deepest folder is the event.
  const structured = year !== null;
  const eventIndex = structured ? i : parts.length - 1;
  const name = parts[eventIndex];
  const match = /^(\d{4}-\d{2}-\d{2})[\s_-]+(.+)$/.exec(name);
  // "RAW" and "Edited" folders inside an event hold the same photos, not a class.
  const inner = parts.slice(eventIndex + 1).filter((p) => !/^(raw|edited)$/i.test(p));
  const className = structured && inner.length ? inner.join(" / ").slice(0, 60) : null;
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

// Reads an event name and date from a folder name such as "20201012",
// "2020-10-12 Sports day", "12-10-2020 Trip" or "Sports day 2020_10_12".
export function guessEvent(folderName: string): { title: string; date: string | null } {
  const name = folderName.trim();
  const valid = (y: number, m: number, d: number) => y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let m = /(\d{4})[-_. ]?(\d{2})[-_. ]?(\d{2})/.exec(name);
  if (m && valid(+m[1], +m[2], +m[3])) return { title: clean(name.replace(m[0], "")), date: iso(+m[1], +m[2], +m[3]) };
  m = /(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/.exec(name);
  if (m && valid(+m[3], +m[2], +m[1])) return { title: clean(name.replace(m[0], "")), date: iso(+m[3], +m[2], +m[1]) };
  return { title: clean(name), date: null };
}

const clean = (s: string) => s.replace(/^[\s_\-.]+|[\s_\-.]+$/g, "").replace(/[_]+/g, " ").replace(/^DCIM$/i, "");
