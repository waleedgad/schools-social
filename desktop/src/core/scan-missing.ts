import path from "node:path";

// After a scan walks the library, which known photos should be marked missing?
// Only those the walk could really see were gone. If the library drive went away
// (or a folder could not be read) while the walk was running, "not seen" does
// not mean "deleted", so nothing under it is touched. They come back by
// themselves when the drive does.
export function missingAfterScan(
  known: Iterable<string>,
  seen: Set<string>,
  library: string,
  unreadable: string[],
  libraryReachable: boolean,
): string[] {
  if (!libraryReachable) return [];
  const blocked = unreadable.map((d) => (d.endsWith(path.sep) ? d : d + path.sep));
  return [...known].filter(
    // Photos moved to the archive drive live outside the library: they are not missing.
    (p) => !seen.has(p) && !path.relative(library, p).startsWith("..") && !blocked.some((d) => p.startsWith(d)),
  );
}
