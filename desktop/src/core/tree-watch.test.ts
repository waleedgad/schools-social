import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { watchTree } from "./tree-watch";

// The one-watch-for-the-whole-tree mode used on Mac and Windows. Node runs it
// on Linux too, so it is checked on every platform.
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await wait(50);
  assert.ok(check());
}

test("whole-tree watch: new, moved-in, removed and hidden photos", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tree-"));
  const outside = mkdtempSync(path.join(tmpdir(), "tree-out-"));
  mkdirSync(path.join(root, "2026-2027", "Term 1"), { recursive: true });
  const events: string[] = [];
  const w = watchTree(root, {
    depth: 10,
    settle: 200,
    native: true,
    ignored: (p, s) => path.basename(p).startsWith(".") || path.basename(p).startsWith("_") || (!!s?.isFile() && !p.endsWith(".jpg")),
  });
  const rel = (f: string) => path.relative(root, f);
  w.on("add", (f) => events.push(`add ${rel(f)}`));
  w.on("unlink", (f) => events.push(`unlink ${rel(f)}`));
  w.on("unlinkDir", (f) => events.push(`unlinkDir ${rel(f)}`));
  await wait(200);

  const one = path.join(root, "2026-2027", "Term 1", "a.jpg");
  writeFileSync(one, "x");
  writeFileSync(path.join(root, "notes.txt"), "x");
  mkdirSync(path.join(root, "_Bin"));
  writeFileSync(path.join(root, "_Bin", "old.jpg"), "x");
  writeFileSync(path.join(root, ".hidden.jpg"), "x");
  await until(() => events.includes("add 2026-2027/Term 1/a.jpg".replace(/\//g, path.sep)));

  // A whole event folder moved in at once.
  const ev = path.join(outside, "2026-10-01 Sports day");
  mkdirSync(ev);
  writeFileSync(path.join(ev, "b.jpg"), "x");
  writeFileSync(path.join(ev, "c.jpg"), "x");
  renameSync(ev, path.join(root, "2026-2027", "Term 1", "2026-10-01 Sports day"));
  await until(() => events.filter((e) => e.startsWith("add") && e.includes("Sports day")).length === 2);

  rmSync(one);
  await until(() => events.includes(`unlink ${rel(one)}`));
  rmSync(path.join(root, "2026-2027", "Term 1", "2026-10-01 Sports day"), { recursive: true });
  await until(() => events.some((e) => e.startsWith("unlinkDir") && e.endsWith("Sports day")));

  await wait(400);
  await w.close();
  assert.ok(!events.some((e) => /notes\.txt|_Bin|\.hidden/.test(e)), events.join("\n"));
  assert.equal(events.filter((e) => e === `add ${rel(one)}`).length, 1, "reported once");
});

test("whole-tree watch: a file still being copied is reported once it stops growing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tree-"));
  const seen: number[] = [];
  const w = watchTree(root, { depth: 2, settle: 300, native: true });
  w.on("add", (_f, s) => seen.push(s.size));
  w.on("change", (_f, s) => seen.push(s.size));
  await wait(200);
  const f = path.join(root, "big.jpg");
  for (let i = 1; i <= 5; i++) {
    writeFileSync(f, "x".repeat(i * 1000));
    await wait(100);
  }
  await until(() => seen.length > 0);
  await wait(800);
  await w.close();
  assert.deepEqual(seen, [5000]);
});

test("whole-tree watch: a library reached through a link reports paths under the link", async () => {
  const real = mkdtempSync(path.join(tmpdir(), "tree-real-"));
  const root = path.join(mkdtempSync(path.join(tmpdir(), "tree-link-")), "Photos");
  symlinkSync(real, root, process.platform === "win32" ? "junction" : "dir");
  const added: string[] = [];
  const w = watchTree(root, { depth: 4, settle: 200, native: true });
  w.on("add", (f) => added.push(f));
  await wait(200);
  writeFileSync(path.join(real, "a.jpg"), "x");
  await until(() => added.length === 1);
  await w.close();
  assert.deepEqual(added, [path.join(root, "a.jpg")]);
});
