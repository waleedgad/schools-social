import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { nearIdentical, otherSizes } from "./cleanup";
import { openDb } from "./db";
import { hamming } from "./media";

// Speed work must never change an answer: these check the fast versions
// against the plain ones, then time them on a big library.

function slowHamming(a: string, b: string) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
}
const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

test("picture fingerprints compare the same, only faster", () => {
  for (let i = 0; i < 5000; i++) {
    const a = hex(16);
    const b = i % 7 === 0 ? a : i % 11 === 0 ? hex(Math.floor(Math.random() * 20) + 1) : hex(16);
    assert.equal(hamming(a, b), slowHamming(a, b), `${a} ${b}`);
  }
  assert.equal(hamming("ffffffffffffffff", "0000000000000000"), 64);
  assert.equal(hamming("F0", "0f"), 8);
  const t = performance.now();
  for (let i = 0; i < 200_000; i++) hamming("a0a0a0a0a0a0a0a0", "9094949494949490");
  assert.ok(performance.now() - t < 400, `200,000 comparisons took ${Math.round(performance.now() - t)} ms`);
});

test("Clean up finds the same bursts and other sizes on a big library, quickly", () => {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "hub-speed-")), "library.db"));
  const add = db.prepare("insert into photos (path, name, ext, mtime, hash, size, width, height, sharpness, dhash, taken_at, missing, is_raw, flag, added_at) values (?, ?, 'jpg', 0, ?, 1000, ?, 480, 50, ?, ?, 0, 0, 0, 0)");
  db.exec("begin");
  // 20,000 photos a minute apart, all looking alike (the worst case), and
  // a few real bursts and resized copies among them.
  const start = Date.parse("2025-03-01T08:00:00Z");
  for (let i = 0; i < 20_000; i++) {
    const burst = i % 1000 === 500 || i % 1000 === 501 || i % 1000 === 502;
    const at = burst ? start + Math.floor(i / 1000) * 1000 * 60_000 + 500 * 60_000 + (i % 1000 - 500) * 2000 : start + i * 60_000;
    const resized = i % 2000 === 7;
    add.run(`/lib/${i}.jpg`, `IMG_${i}.jpg`, `h${i}`, resized ? 320 : 640, i % 2000 === 7 || i % 2000 === 6 ? "ffff0000ffff0000" : "a0a0a0a0a0a0a0a0", new Date(at).toISOString());
  }
  db.exec("commit");
  const t0 = performance.now();
  const bursts = nearIdentical(db);
  const t1 = performance.now();
  const sizes = otherSizes(db);
  const t2 = performance.now();
  assert.equal(bursts.length, 20, "one burst of three in every thousand");
  assert.ok(bursts.every((g) => g.extra.length === 2));
  assert.equal(sizes.reduce((n, g) => n + g.extra.length, 0), 10, "one resized copy in every two thousand");
  assert.ok(t1 - t0 < 400, `bursts took ${Math.round(t1 - t0)} ms`);
  assert.ok(t2 - t1 < 400, `other sizes took ${Math.round(t2 - t1)} ms`);
  db.close();
});
