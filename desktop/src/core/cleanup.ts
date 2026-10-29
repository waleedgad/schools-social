import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db";
import { hamming } from "./media";

// What the Clean up tab can free. Nothing is deleted here: the app moves
// what the person chooses to the Bin. RAW and JPEG pairs are always kept.

export type CleanPhoto = { id: number; path: string; size: number; width: number | null; height: number | null; quality: number | null; sharpness: number | null; brightness: number | null; name: string; taken_at: string | null; edited_of: number | null; reason?: string };
export type CleanGroup = { keep: number; extra: number[]; size: number; kept?: number[] };

const COLS = "id, path, size, width, height, quality, sharpness, brightness, name, taken_at, edited_of";
const BASE = "missing = 0 and pair_of is null and is_raw = 0";

// Which copy to keep: an original over an export or WhatsApp copy, then the
// biggest, then the sharpest.
const looksLikeCopy = (name: string) => /whatsapp|img-\d{8}-wa|\bcopy\b|نسخة|-export|_small|resized/i.test(name);
function rank(p: CleanPhoto) {
  return (looksLikeCopy(p.name) ? 0 : 1e12) + (p.width ?? 0) * (p.height ?? 0) * 10 + (p.sharpness ?? 0);
}

// Photos never offered for cleaning: posted, picked (flag or 4-5 stars), in a
// yearbook, or with someone named in them. In a group, a protected photo is
// kept too (and becomes the one kept if the best one isn't protected).
export function protectedIds(db: Db) {
  const ids = new Set<number>(
    (db.prepare("select id from photos where posts > 0 or flag = 1 or rating >= 4 or exists (select 1 from faces f where f.photo_id = photos.id and f.status in ('confirmed', 'manual'))").all() as { id: number }[]).map((r) => r.id),
  );
  for (const b of db.prepare("select spec, pages, locked from books").all() as { spec: string | null; pages: string | null; locked: string | null }[])
    for (const text of [b.spec, b.pages, b.locked]) {
      if (!text) continue;
      try {
        walk(JSON.parse(text), ids);
      } catch {}
    }
  return ids;
}
function walk(v: unknown, ids: Set<number>, key = "") {
  if (Array.isArray(v)) v.forEach((x) => walk(x, ids, key));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, ids, k);
  else if (typeof v === "number" && /^(photo|photos|photoId|photoIds|ids|cover)$/i.test(key)) ids.add(v);
}
export function guardGroups(groups: CleanGroup[], prot: Set<number>, sizeOf: (id: number) => number) {
  const out: CleanGroup[] = [];
  for (const g of groups) {
    const extra = g.extra.filter((id) => !prot.has(id));
    if (!extra.length) continue;
    out.push({ ...g, extra, size: extra.reduce((n, id) => n + sizeOf(id), 0), kept: g.extra.filter((id) => prot.has(id)) } as CleanGroup);
  }
  return out;
}

function group<T extends CleanPhoto>(rows: T[], same: (a: T, b: T) => boolean): CleanGroup[] {
  const used = new Set<number>();
  const out: CleanGroup[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (used.has(rows[i].id)) continue;
    const members = [rows[i]];
    for (let j = i + 1; j < rows.length && j < i + 40; j++) {
      if (!used.has(rows[j].id) && same(rows[i], rows[j])) members.push(rows[j]);
    }
    if (members.length < 2) continue;
    members.forEach((m) => used.add(m.id));
    const best = [...members].sort((a, b) => rank(b) - rank(a))[0];
    const extra = members.filter((m) => m.id !== best.id);
    out.push({ keep: best.id, extra: extra.map((m) => m.id), size: extra.reduce((s, m) => s + m.size, 0) });
  }
  return out;
}

export function exactCopies(db: Db) {
  const rows = db.prepare(`select d.id, d.size, d.dup_of from photos d join photos o on o.id = d.dup_of where d.missing = 0 and o.missing = 0 and d.is_raw = 0`).all() as { id: number; size: number; dup_of: number }[];
  const byKeep = new Map<number, CleanGroup>();
  for (const r of rows) {
    const g = byKeep.get(r.dup_of) ?? { keep: r.dup_of, extra: [], size: 0 };
    g.extra.push(r.id);
    g.size += r.size;
    byKeep.set(r.dup_of, g);
  }
  return guarded(db, [...byKeep.values()]);
}

function guarded(db: Db, groups: CleanGroup[]) {
  const prot = protectedIds(db);
  const size = db.prepare("select size from photos where id = ?");
  return guardGroups(groups, prot, (id) => (size.get(id) as { size: number } | undefined)?.size ?? 0);
}

// The same picture saved again: resized, exported or sent over WhatsApp.
// Same look (tiny image difference), different file. Edited versions are
// kept with their original, never offered here.
export function otherSizes(db: Db) {
  const rows = db.prepare(`select ${COLS}, dhash from photos where ${BASE} and dup_of is null and edited_of is null and dhash is not null order by dhash`).all() as (CleanPhoto & { dhash: string })[];
  return guarded(db, group(rows, (a, b) => hamming(a.dhash, b.dhash) <= 2 && (a.width !== b.width || looksLikeCopy(a.name) || looksLikeCopy(b.name)) && !hasEdit(db, a.id, b.id)));
}

function hasEdit(db: Db, a: number, b: number) {
  return !!db.prepare("select 1 from photos where (id = ? and edited_of = ?) or (id = ? and edited_of = ?)").get(a, b, b, a);
}

// Bursts: shots seconds apart that look nearly the same. The best is kept.
export function nearIdentical(db: Db) {
  const rows = db.prepare(`select ${COLS}, dhash from photos where ${BASE} and dup_of is null and edited_of is null and dhash is not null and taken_at is not null and flag >= 0 order by taken_at`).all() as (CleanPhoto & { dhash: string })[];
  return guarded(db, group(rows, (a, b) => Math.abs(Date.parse(a.taken_at!) - Date.parse(b.taken_at!)) < 15_000 && hamming(a.dhash, b.dhash) <= 6));
}

// Blurry, too dark or too bright. Strict = "strict" catches more.
export function badPhotos(db: Db, strict: "gentle" | "normal" | "strict" = "normal") {
  const sharpMin = { gentle: 12, normal: 25, strict: 45 }[strict];
  const darkMax = { gentle: 0.07, normal: 0.11, strict: 0.15 }[strict];
  const brightMin = { gentle: 0.95, normal: 0.92, strict: 0.88 }[strict];
  const rows = db
    .prepare(`select ${COLS} from photos where ${BASE} and dup_of is null and flag = 0 and sharpness is not null and (sharpness < ? or brightness < ? or brightness > ?) order by sharpness limit 2000`)
    .all(sharpMin, darkMax, brightMin) as CleanPhoto[];
  const prot = protectedIds(db);
  return rows.filter((r) => !prot.has(r.id)).map((r) => ({ ...r, reason: (r.sharpness ?? 99) < sharpMin ? "blurry" : (r.brightness ?? 0.5) < darkMax ? "dark" : "bright" }));
}

export function oldRejected(db: Db, months: number) {
  const before = Date.now() - months * 30 * 86400_000;
  const prot = protectedIds(db);
  return (db.prepare(`select ${COLS} from photos where missing = 0 and flag = -1 and pair_of is null and added_at < ? order by added_at`).all(before) as CleanPhoto[]).filter((r) => !prot.has(r.id));
}

// Folders with no photos (and nothing else) left in them.
export async function emptyFolders(library: string) {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<boolean> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return false;
    let empty = true;
    for (const e of entries) {
      if (e.name === ".DS_Store") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".") && depth < 10) {
        if (!(await walk(full, depth + 1))) empty = false;
      } else empty = false;
    }
    if (empty && dir !== library) found.push(dir);
    return empty;
  }
  await walk(library, 0);
  return found;
}

export async function removeEmptyFolders(folders: string[]) {
  let n = 0;
  // Deepest first, so parents empty out after their children.
  for (const f of [...folders].sort((a, b) => b.length - a.length)) {
    const left = await readdir(f).catch(() => null);
    if (!left || left.some((x) => x !== ".DS_Store")) continue;
    await rm(f, { recursive: true }).catch(() => {});
    n++;
  }
  return n;
}

export async function folderSize(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    total += e.isDirectory() ? await folderSize(full) : ((await stat(full).catch(() => null))?.size ?? 0);
  }
  return total;
}
