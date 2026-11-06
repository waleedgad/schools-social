import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkpointInBackground, openDb } from "./db";

// B-49 (Windows froze 3-5 s during big imports): the app's own connection
// never writes the journal back into the library file; a background thread
// does, so the library file still grows to hold what was written.
test("the journal is written back into the library by the background thread", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "hub-ckpt-")), "library.db");
  const db = openDb(file);
  checkpointInBackground(db, file, 300);
  assert.equal((db.prepare("pragma wal_autocheckpoint").get() as Record<string, number>).wal_autocheckpoint, 0);
  const before = statSync(file).size;
  db.exec("create table blob_test (b blob)");
  const add = db.prepare("insert into blob_test (b) values (?)");
  for (let i = 0; i < 200; i++) add.run(Buffer.alloc(10_000, i));
  assert.equal(statSync(file).size, before, "the app's own connection wrote back by itself");
  const end = Date.now() + 5000;
  while (statSync(file).size <= before + 1_000_000 && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  assert.ok(statSync(file).size > before + 1_000_000, `library file is still ${statSync(file).size} bytes`);
  db.close();
  // Closing writes back the rest; the library opens again with everything in it.
  const again = openDb(file);
  assert.equal((again.prepare("select count(*) n from blob_test").get() as { n: number }).n, 200);
  again.close();
});
