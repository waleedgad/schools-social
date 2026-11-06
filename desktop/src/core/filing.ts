import path from "node:path";
import type { Db } from "./db";
import { guessEvent, placeFromPath } from "./library";

// Self-filing (off unless the school turns it on): photos whose folder is
// not yet Year / Term / Event are moved into place inside the same folder.
// Photos already in an event folder are never moved, and "_" folders are
// left alone. When the app isn't sure (no date at all), it asks instead.

export type FilingMove = { id: number; title: string; date: string; className: string | null };
const CLASS = /^(KG\s?\d[A-Z]?|\d{1,2}\s?[A-Z]|Grade\s?\d{1,2}\s?[A-Z]?)$/i;

export function planFiling(db: Db, library: string, onlyIds?: number[]) {
  const rows = db
    // A RAW with its JPEG moves with the JPEG, never by itself.
    .prepare(`select id, path, taken_at, mtime from photos where missing = 0 and pair_of is null ${onlyIds?.length ? `and id in (${onlyIds.map(() => "?").join(",")})` : ""}`)
    .all(...(onlyIds ?? [])) as { id: number; path: string; taken_at: string | null; mtime: number }[];
  const moves: FilingMove[] = [];
  const unsure: number[] = [];
  for (const r of rows) {
    const rel = path.relative(library, path.dirname(r.path));
    // Already under a Year folder: filed, or put there by someone on purpose.
    if (rel.startsWith("..") || placeFromPath(library, r.path).year) continue;
    const parts = rel ? rel.split(path.sep) : [];
    // "Drop here" files itself (see the Import tab), on its own timer.
    if (parts.some((p) => p.startsWith("_") || p.startsWith(".")) || parts[0] === "Drop here") continue;
    let className: string | null = null;
    if (/^raw$/i.test(parts.at(-1) ?? "")) parts.pop();
    let folder = parts.at(-1) ?? "";
    if (CLASS.test(folder) && parts.length > 1) {
      className = folder.toUpperCase().replace(/\s+/g, "");
      folder = parts.at(-2)!;
    }
    const guess = guessEvent(folder);
    const fileGuess = guessEvent(path.basename(r.path, path.extname(r.path)));
    const date = guess.date ?? r.taken_at?.slice(0, 10) ?? fileGuess.date ?? null;
    if (!date) {
      unsure.push(r.id);
      continue;
    }
    moves.push({ id: r.id, title: guess.title || (folder ? folder : "Unsorted"), date, className });
  }
  return { moves, unsure };
}

// Groups moves by where they go, so each target folder is made once.
export function groupMoves(moves: FilingMove[]) {
  const groups = new Map<string, { title: string; date: string; className: string | null; ids: number[] }>();
  for (const m of moves) {
    const key = `${m.date}|${m.title}|${m.className ?? ""}`;
    const g = groups.get(key) ?? { title: m.title, date: m.date, className: m.className, ids: [] };
    g.ids.push(m.id);
    groups.set(key, g);
  }
  return [...groups.values()];
}
