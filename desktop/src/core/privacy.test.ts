import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "./db";
import { noPostPhoto } from "./privacy";

// B-54: a photo the app thinks shows a student who can't appear is kept off
// the website (blocked or blurred) like a named one, until someone says it
// isn't them. Before, only faces named by hand or automatically counted, so
// a likely match could be posted.
test("a likely match with a student who can't appear counts, a rejected one doesn't", () => {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "hub-privacy-")), "library.db"));
  db.prepare("insert into students (id, name_en, can_post, added_at) values ('NO', 'Hidden', 0, 1), ('OK', 'Fine', 1, 1)").run();
  const photo = (name: string, faces: [string, string | null, string | null][]) => {
    const id = Number(db.prepare("insert into photos (path, name, ext, size, mtime, added_at) values (?, ?, '.jpg', 1, 1, 1)").run(`/x/${name}`, name).lastInsertRowid);
    for (const [status, student, suggest] of faces)
      db.prepare("insert into faces (photo_id, x, y, w, h, score, status, student_id, suggest_id, suggest_score) values (?, 0.1, 0.1, 0.2, 0.2, 0.9, ?, ?, ?, 0.55)").run(id, status, student, suggest);
  };
  photo("named.jpg", [["confirmed", "NO", null]]);
  photo("suggested.jpg", [["suggested", null, "NO"]]);
  photo("other.jpg", [["confirmed", "OK", null], ["suggested", null, "OK"]]);
  photo("said-no.jpg", [["rejected", null, "NO"]]);
  photo("unknown.jpg", [["unknown", null, null]]);
  const blocked = (db.prepare(`select p.name from photos p where ${noPostPhoto("p")} order by p.name`).all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(blocked, ["named.jpg", "suggested.jpg"]);
  db.close();
});
