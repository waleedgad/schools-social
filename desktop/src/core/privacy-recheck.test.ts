import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "./db";
import { noPostWebPhoto, photosOfPeople, withCopies } from "./privacy";

// Found 17 Nov 2026 by the code review of 0.11 and 0.12. Each test fails on
// the code before the fix (the helpers didn't exist; the old lists missed
// these photos).

function library() {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "hub-recheck-")), "library.db"));
  db.prepare("insert into students (id, name_en, can_post, added_at) values ('S1', 'Sara', 1, 1), ('S2', 'Omar', 1, 1)").run();
  const photo = (name: string, dupOf: number | null = null) =>
    Number(db.prepare("insert into photos (path, name, ext, size, mtime, added_at, faces_scanned, dup_of) values (?, ?, '.jpg', 1, 1, 1, 1, ?)").run(`/x/${name}`, name, dupOf).lastInsertRowid);
  const face = (photoId: number, status: string, studentId: string | null, suggestId: string | null, score: number | null, why: string | null = null) =>
    db.prepare("insert into faces (photo_id, x, y, w, h, status, student_id, suggest_id, suggest_score, why) values (?, 0.1, 0.1, 0.05, 0.05, ?, ?, ?, ?, ?)").run(photoId, status, studentId, suggestId, score, why);
  return { db, photo, face };
}

// B-110: turning someone to "can't appear" (switch, class list, undo) must
// check again every photo the privacy rule looks at for them, far faces
// that are a likely match too. Before, only named and suggested faces.
test("B-110: the photos checked again for a person include far likely matches and copies", () => {
  const { db, photo, face } = library();
  const named = photo("named.jpg");
  face(named, "confirmed", "S1", null, null);
  const far = photo("far.jpg");
  face(far, "unknown", null, "S1", 0.62, "far");
  const other = photo("other.jpg");
  face(other, "confirmed", "S2", null, null);
  const copy = photo("upload.jpg", far);
  assert.deepEqual(photosOfPeople(db, ["S1"]).sort((a, b) => a - b), [named, far, copy]);
  assert.deepEqual(photosOfPeople(db, []), []);
  // and the far likely match does block once S1 can't appear
  db.prepare("update students set can_post = 0 where id = 'S1'").run();
  const blocked = (id: number) => (db.prepare(`select ${noPostWebPhoto("p")} b from photos p where p.id = ?`).get(id) as { b: number }).b;
  assert.equal(blocked(far), 1);
  assert.equal(blocked(other), 0);
  db.close();
});

// B-111: a website upload that is an exact copy of a library photo has no
// faces of its own; later names on the library photo must decide for it.
test("B-111: an exact copy follows its main photo's faces", () => {
  const { db, photo, face } = library();
  const main = photo("lib.jpg");
  const copy = photo("upload.jpg", main);
  const blocked = (id: number) => (db.prepare(`select ${noPostWebPhoto("p")} b from photos p where p.id = ?`).get(id) as { b: number }).b;
  assert.equal(blocked(copy), 0);
  db.prepare("update students set can_post = 0 where id = 'S2'").run();
  face(main, "confirmed", "S2", null, null);
  assert.equal(blocked(copy), 1, "named later on the library photo: the copy is blocked too");
  assert.deepEqual(withCopies(db, [main]).sort((a, b) => a - b), [main, copy], "re-checking the library photo includes its copy");
  db.close();
});
