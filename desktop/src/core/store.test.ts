import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, mock } from "node:test";
import { JsonStore } from "./store";

// Found 17 Nov 2026 (tricky bugs): on Windows the swap of the saved file
// fails now and then while the antivirus or indexer has it open (EPERM).
// That error came out of the upload queue and settings.
test("a saved file busy for a moment (Windows) is still saved", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "hub-store-")), "queue.json");
  const store = new JsonStore(file, { n: 0 });
  const real = fs.renameSync;
  let fails = 2;
  const busy = mock.method(fs, "renameSync", (a: fs.PathLike, b: fs.PathLike) => {
    if (fails-- > 0) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    return real(a, b);
  });
  store.set({ n: 1 });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).n, 1);
  // Busy every time: written in place, never lost.
  fails = 100;
  store.set({ n: 2 });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).n, 2);
  busy.mock.restore();
  assert.equal(new JsonStore(file, { n: 0 }).get().n, 2);
});
