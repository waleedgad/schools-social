import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { watchStalls } from "./busy";
import { openDb } from "./db";

// When the app is too busy to answer, the log names the slow step (here a
// database step that holds everything up), not only what was running.
test("a stall in the log names the slow database step", async () => {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "hub-busy-")), "library.db"));
  const lines: string[] = [];
  const stop = watchStalls((m) => lines.push(m), 500);
  await new Promise((r) => setTimeout(r, 250));
  db.prepare("with recursive n(i) as (select 1 union all select i + 1 from n where i < 30000000) select count(*) c from n").get();
  await new Promise((r) => setTimeout(r, 450));
  stop();
  db.close();
  const line = lines.find((l) => l.includes("busy for"));
  assert.ok(line, `no stall noted: ${lines.join(" | ")}`);
  assert.match(line, /slow steps: database: with recursive n\(i\)/);
});
