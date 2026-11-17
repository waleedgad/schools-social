import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { missingAfterScan } from "./scan-missing";

const lib = path.join(path.sep, "Volumes", "School", "Photos");
const f = (...p: string[]) => path.join(lib, ...p);
const archive = path.join(path.sep, "Volumes", "Archive", "2019", "a.jpg");

test("photos the walk did not see are marked missing", () => {
  const known = [f("2026", "A", "1.jpg"), f("2026", "A", "2.jpg"), archive];
  const gone = missingAfterScan(known, new Set([f("2026", "A", "1.jpg")]), lib, [], true);
  assert.deepEqual(gone, [f("2026", "A", "2.jpg")]);
});

test("the library drive unplugged during the walk: nothing is marked missing", () => {
  const known = [f("2026", "A", "1.jpg"), f("2026", "B", "2.jpg")];
  assert.deepEqual(missingAfterScan(known, new Set([f("2026", "A", "1.jpg")]), lib, [], false), []);
});

test("a folder that could not be read keeps its photos, other folders are still checked", () => {
  const known = [f("2026", "A", "1.jpg"), f("2026", "B", "2.jpg"), f("2026", "B", "deep", "3.jpg"), f("2026", "C", "4.jpg")];
  const gone = missingAfterScan(known, new Set([f("2026", "A", "1.jpg")]), lib, [f("2026", "B")], true);
  assert.deepEqual(gone, [f("2026", "C", "4.jpg")]);
});

test("a folder name that only starts the same is not blocked", () => {
  const known = [f("2026", "B2", "1.jpg")];
  assert.deepEqual(missingAfterScan(known, new Set(), lib, [f("2026", "B")], true), [f("2026", "B2", "1.jpg")]);
});
