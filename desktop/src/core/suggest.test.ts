import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDb } from "./db";
import { Engine } from "./engine";
import { clearEnough, facePx, likelihood, SHOW_FROM, SUGGEST_PX, SUGGEST_SHARP, VERY_LIKELY } from "./faces";

// Waleed, 7 Nov 2026: "it still suggests faces with 43%, 50%… it should only
// suggest 90%+". Suggestions now say "Very likely" / "Likely" only where the
// face test found them right at least 9 times in 10.
test("suggestion labels: nothing below the cut-off, words above it", () => {
  assert.equal(likelihood(null), null);
  assert.equal(likelihood(0.43), null);
  assert.equal(likelihood(0.5), null);
  assert.equal(likelihood(SHOW_FROM - 0.001), null);
  assert.equal(likelihood(SHOW_FROM), "likely");
  assert.equal(likelihood(VERY_LIKELY), "very");
  assert.ok(SHOW_FROM < VERY_LIKELY && VERY_LIKELY < 0.62);
});

test("far and blurred faces are never suggested", () => {
  // faces are read from the original photo (up to 6000 px): a 3% wide face
  // in a 6000 x 4000 photo is 180 px, in a 2400 px photo 72 px
  assert.equal(Math.round(facePx(0.03, 6000, 4000)), 180);
  assert.equal(Math.round(facePx(0.03, 12000, 8000)), 180);
  assert.equal(facePx(0.1, 1000, 800), 100);
  assert.equal(clearEnough(facePx(0.03, 2400, 1600), 200), false);
  assert.equal(clearEnough(SUGGEST_PX, 200), true);
  assert.equal(clearEnough(200, SUGGEST_SHARP - 1), false);
  assert.equal(clearEnough(200, null), true);
});

test("an old library: weak suggestions go, far faces stop asking", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-sug-"));
  const db = openDb(path.join(dir, "library.db"));
  db.exec(`insert into photos (id, path, name, ext, size, mtime, added_at, width, height) values (1, '/x/a.jpg', 'a.jpg', '.jpg', 1, 1, 1, 6000, 4000);
    insert into students (id, name_en, added_at) values ('S1', 'Youssef', 1);
    insert into faces (photo_id, x, y, w, h, status, suggest_id, suggest_score) values
      (1, 0.1, 0.1, 0.1, 0.15, 'suggested', 'S1', 0.43),
      (1, 0.3, 0.1, 0.1, 0.15, 'suggested', 'S1', 0.6),
      (1, 0.5, 0.1, 0.03, 0.045, 'suggested', 'S1', 0.6),
      (1, 0.7, 0.1, 0.03, 0.045, 'unknown', null, null),
      (1, 0.8, 0.1, 0.03, 0.045, 'confirmed', null, null);`);
  const engine = new Engine({ db, library: dir, cache: path.join(dir, "cache"), models: dir, faces: () => false, paused: () => false, onChange: () => {} });
  assert.equal(engine.tidySuggestions(), 3);
  const rows = db.prepare("select status, why from faces order by id").all() as { status: string; why: string | null }[];
  assert.deepEqual(
    rows.map((r) => [r.status, r.why]),
    [["unknown", null], ["suggested", null], ["unknown", "far"], ["unknown", "far"], ["confirmed", null]],
  );
  assert.equal(engine.tidySuggestions(), 0); // once is enough
});
