import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "./db";
import { Engine } from "./engine";

// Found 16 Nov 2026 (thread "Fix tricky app bugs"): a photo retouched while
// the app was closed was never noticed. The folder watch only sees changes
// while the app runs, and the scan at start skipped every known file
// without looking at its size or date, so the old faces and pictures stayed.
test("a photo changed while the app was closed is read again at the next start", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-scan-"));
  const library = path.join(dir, "Photos");
  const folder = path.join(library, "2026-2027", "Term 1", "2026-10-20 Sports day");
  mkdirSync(folder, { recursive: true });
  const changed = path.join(folder, "a.jpg");
  const same = path.join(folder, "b.jpg");
  writeFileSync(changed, "first version");
  writeFileSync(same, "never touched");
  const db = openDb(path.join(dir, "library.db"));
  const engine = new Engine({ db, library, cache: path.join(dir, "cache"), models: dir, faces: () => false, paused: () => false, onChange: () => {} });
  const add = db.prepare("insert into photos (path, name, ext, size, mtime, added_at, hash, thumb, faces_scanned) values (?, ?, '.jpg', ?, ?, 1, 'h', 1, 1)");
  for (const f of [changed, same]) {
    const s = statSync(f);
    add.run(f, path.basename(f), s.size, Math.round(s.mtimeMs));
  }

  // Retouched in another app while the Mac app was closed.
  writeFileSync(changed, "second, longer version");
  utimesSync(changed, new Date(), new Date(Date.now() + 5000));

  await engine.scan();
  const row = (f: string) => db.prepare("select thumb, faces_scanned, hash, size from photos where path = ?").get(f) as { thumb: number; faces_scanned: number; hash: string | null; size: number };
  assert.equal(row(changed).thumb, 0, "its pictures are made again");
  assert.equal(row(changed).faces_scanned, 0, "its faces are looked for again");
  assert.equal(row(changed).hash, null);
  assert.equal(row(changed).size, statSync(changed).size);
  assert.equal(row(same).thumb, 1, "an untouched photo is left alone");
  assert.equal(row(same).hash, "h");
  assert.equal(engine.status.found, 0, "no photo counted as new");
  await engine.stop();
});
