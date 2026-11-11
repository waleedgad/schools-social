import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "./db";
import { webCheck } from "./privacy";
import { promoteYears } from "./students";

// Flaws found 11 Nov 2026 in the app's other features (thread "Find flaws
// in faces and app features"). Each test fails on the code before the fix.

// B-87: "New school year" in September recorded last year's classes under
// the new year; done in June, it was offered again in September as not done.
test("B-87: New school year keeps the right year, done in June or in September", () => {
  const june = new Date(2026, 5, 20), sept = new Date(2026, 8, 10), dec = new Date(2026, 11, 1), feb = new Date(2027, 1, 1);
  // First time, in June: 2025-2026 ends, next is 2026-2027
  assert.deepEqual(promoteYears(june, null), { year: "2025-2026", next: "2026-2027", alreadyDone: false });
  // First time, in September (new lists): still 2025-2026's classes, next is this year
  assert.deepEqual(promoteYears(sept, null), { year: "2025-2026", next: "2026-2027", alreadyDone: false });
  assert.deepEqual(promoteYears(sept, "2024-2025"), { year: "2025-2026", next: "2026-2027", alreadyDone: false });
  // Done in June, opened again in September or December: already done
  assert.deepEqual(promoteYears(sept, "2025-2026"), { year: "2025-2026", next: "2026-2027", alreadyDone: true });
  assert.deepEqual(promoteYears(dec, "2025-2026"), { year: "2025-2026", next: "2026-2027", alreadyDone: true });
  // Done in June 2026, opened in June 2026 again: already done
  assert.deepEqual(promoteYears(june, "2025-2026"), { year: "2025-2026", next: "2026-2027", alreadyDone: true });
  // February: the year that's running ends in the summer
  assert.deepEqual(promoteYears(feb, "2025-2026"), { year: "2026-2027", next: "2027-2028", alreadyDone: false });
});

// B-91: a photo uploaded on the website that is an exact copy of a library
// photo waited for its face check for ever (copies are never scanned), and
// one the face finder couldn't read was let through unchecked.
test("B-91: website uploads: exact copies use the library photo's faces; unreadable ones stay blocked", () => {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "hub-check-")), "library.db"));
  db.prepare("insert into students (id, name_en, can_post, added_at) values ('NO', 'Hidden', 0, 1)").run();
  const photo = (name: string, scanned: number, dupOf: number | null = null) =>
    Number(db.prepare("insert into photos (path, name, ext, size, mtime, added_at, faces_scanned, dup_of) values (?, ?, '.jpg', 1, 1, 1, ?, ?)").run(`/x/${name}`, name, scanned, dupOf).lastInsertRowid);
  const lib = photo("lib.jpg", 1);
  db.prepare("insert into faces (photo_id, x, y, w, h, status, student_id) values (?, 0.1, 0.1, 0.2, 0.2, 'confirmed', 'NO')").run(lib);
  const copy = photo("upload.jpg", 0, lib);
  assert.deepEqual(webCheck(db, copy, true), { ready: true, optedOut: true }, "the copy is checked with the library photo's faces");
  const unreadable = photo("broken.jpg", -1);
  assert.deepEqual(webCheck(db, unreadable, true), { ready: true, optedOut: true }, "never checked: stays blocked");
  const waiting = photo("new.jpg", 0);
  assert.equal(webCheck(db, waiting, true).ready, false);
  const clean = photo("clean.jpg", 1);
  assert.deepEqual(webCheck(db, clean, true), { ready: true, optedOut: false });
  assert.deepEqual(webCheck(db, waiting, false), { ready: true, optedOut: false }, "face finding off: nothing to wait for");
  db.close();
});
