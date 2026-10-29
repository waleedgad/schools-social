import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { bursts, calendarName, copyVerified, junkReason, likelyClass, linkKind, lookAt, oneDriveShareId, parseDriveFolder, splitByGaps } from "./importer";

const at = (s: string) => Date.parse(s);

test("a card is split into events by day and by long gaps", () => {
  const files = ["2026-10-20T08:00", "2026-10-20T08:30", "2026-10-20T13:00", "2026-10-21T09:00"].map((t, i) => ({ taken: at(t), n: i }));
  const groups = splitByGaps(files, 2);
  assert.deepEqual(groups.map((g) => g.map((f) => f.n)), [[0, 1], [2], [3]]);
});

test("shots within a second on one camera are a burst", () => {
  const f = (t: number, camera = "R6", file = `${t}`) => ({ taken: t, camera, file });
  const g = bursts([f(0), f(400), f(900), f(5000), f(5100, "iPhone"), f(9000)]);
  assert.equal(g.length, 1);
  assert.equal(g[0].length, 3);
});

test("pocket, blank and very blurry shots are spotted", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-imp-"));
  const black = path.join(dir, "black.jpg");
  const noisy = path.join(dir, "noisy.jpg");
  await sharp({ create: { width: 200, height: 150, channels: 3, background: { r: 3, g: 3, b: 3 } } }).jpeg().toFile(black);
  const px = Buffer.alloc(200 * 150 * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 7919) % 251;
  await sharp(px, { raw: { width: 200, height: 150, channels: 3 } }).jpeg().toFile(noisy);
  assert.equal(junkReason(await lookAt(black, path.join(dir, "t1.jpg"))), "dark");
  assert.equal(junkReason(await lookAt(noisy, path.join(dir, "t2.jpg"))), null);
});

test("event names come from the school calendar, not from terms or holidays", () => {
  const cal = [{ name: "Term 1", start: "2026-09-01", end: "2026-12-20" }, { name: "Sports day", start: "2026-10-20", end: "2026-10-20" }, { name: "Winter holiday", start: "2026-12-21", end: "2027-01-05" }];
  assert.equal(calendarName("2026-10-20", cal), "Sports day");
  assert.equal(calendarName("2026-10-21", cal), "");
  assert.equal(calendarName("2026-12-25", cal), "");
});

test("a copy is checked byte by byte", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-copy-"));
  writeFileSync(path.join(dir, "a.jpg"), "photo bytes");
  await copyVerified(path.join(dir, "a.jpg"), path.join(dir, "b.jpg"));
  assert.equal(readFileSync(path.join(dir, "b.jpg"), "utf8"), "photo bytes");
  await assert.rejects(copyVerified(path.join(dir, "a.jpg"), path.join(dir, "c.jpg"), "wrong-hash"), /copy-check-failed/);
});

test("the class is suggested only when most faces agree", () => {
  assert.equal(likelyClass(["4B", "4B", "4B", "4A"])?.className, "4B");
  assert.equal(likelyClass(["4B", "4A", "3C", "4B"]), null);
  assert.equal(likelyClass(["4B", "4B"]), null);
});

test("shared links are recognised and read", () => {
  assert.deepEqual(linkKind("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing"), { kind: "gdrive-folder", id: "1AbCdEfGhIjKlMn" });
  assert.equal(linkKind("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view")?.kind, "gdrive-file");
  assert.equal(linkKind("https://1drv.ms/f/s!Abc")?.kind, "onedrive");
  assert.equal(linkKind("https://example.com/x"), null);
  assert.equal(oneDriveShareId("https://1drv.ms/f/s!Abc"), "u!aHR0cHM6Ly8xZHJ2Lm1zL2Yvcy1BYmM".replace("cy1BYmM", "cyFBYmM"));
  const html = `<div class="flip-entry" id="entry-111aaa"><a href="https://drive.google.com/file/d/111aaa/view"><div class="flip-entry-title">IMG_1.jpg</div></a></div><div class="flip-entry" id="entry-222bbb"><a href="https://drive.google.com/drive/folders/222bbb"><div class="flip-entry-title">Day 2</div></a></div>`;
  assert.deepEqual(parseDriveFolder(html), [{ id: "111aaa", name: "IMG_1.jpg", folder: false }, { id: "222bbb", name: "Day 2", folder: true }]);
});
