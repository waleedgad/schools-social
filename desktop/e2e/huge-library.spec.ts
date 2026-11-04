import { _electron, expect, test } from "@playwright/test";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// A school's library after a few years: 20,000 photos in 100 events. The app
// must still open, show the library, search and switch tabs quickly. The
// photos are real files on disk (hard links, so the test stays small) and the
// library already knows them, as it would after the first import.
const root = path.join(__dirname, "..");
const EVENTS = 100;
const PER_EVENT = 200;
const TABS = ["today", "library", "faces", "students", "coverage", "cleanup", "posts", "calendar", "history", "settings"];

type W = { lib: { list: unknown[] }; hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };

function launch(userData: string) {
  return _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
}

test("a library of 20,000 photos stays quick", async () => {
  test.setTimeout(600_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-huge-"));
  const lib = path.join(base, "Photos");
  const folders: string[] = [];
  for (let e = 0; e < EVENTS; e++) {
    const year = e < 50 ? "2024-2025" : "2025-2026";
    const term = `Term ${(e % 3) + 1}`;
    const day = `2025-${String((e % 12) + 1).padStart(2, "0")}-${String((e % 27) + 1).padStart(2, "0")}`;
    const dir = path.join(lib, year, term, `${day} Event ${e}`);
    mkdirSync(dir, { recursive: true });
    const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: (e * 37) % 255, g: (e * 91) % 255, b: (e * 53) % 255 } } })
      .composite([{ input: Buffer.from(`<svg width="640" height="480"><rect x="${(e * 6) % 600}" y="40" width="40" height="400" fill="white"/></svg>`), top: 0, left: 0 }])
      .jpeg()
      .toBuffer();
    writeFileSync(path.join(dir, "IMG_0000.jpg"), img);
    folders.push(dir);
  }
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));

  // First the app reads one photo per event, as a school's first import would.
  let app = await launch(userData);
  let win = await app.firstWindow();
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 120_000 }).toBe(EVENTS);
  await expect.poll(() => win.evaluate("lib.list.filter((p) => p.thumb === 1).length"), { timeout: 120_000 }).toBe(EVENTS);
  await app.close();

  // Then 199 more in each event: same file on disk, its own row and thumbnail.
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  const cols = (db.prepare("pragma table_info(photos)").all() as { name: string }[]).map((c) => c.name).filter((c) => !["id", "path", "name", "hash"].includes(c));
  const rows = db.prepare("select id, path from photos").all() as { id: number; path: string }[];
  const copy = db.prepare(`insert into photos (path, name, hash, ${cols.join(", ")}) select ?, ?, ?, ${cols.join(", ")} from photos where id = ?`);
  const thumbs = path.join(userData, "cache", "thumbs");
  db.exec("begin");
  let n = 0;
  for (const r of rows) {
    for (let i = 1; i < PER_EVENT; i++) {
      const name = `IMG_${String(i).padStart(4, "0")}.jpg`;
      const file = path.join(path.dirname(r.path), name);
      linkSync(r.path, file);
      const id = Number(copy.run(file, name, `huge-${++n}`, r.id).lastInsertRowid);
      linkSync(path.join(thumbs, `${r.id}.jpg`), path.join(thumbs, `${id}.jpg`));
    }
  }
  db.exec("commit");
  expect((db.prepare("select count(*) n from photos").get() as { n: number }).n).toBe(EVENTS * PER_EVENT);
  db.close();
  expect(readdirSync(folders[0])).toHaveLength(PER_EVENT);

  // Open it again: everything below is what the school feels.
  const t0 = Date.now();
  app = await launch(userData);
  win = await app.firstWindow();
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  await win.locator('button.nav[data-go="library"]').click();
  // The grid holds the first 8,000; the title gives the real size and says how to see the rest.
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 120_000 }).toBe(8000);
  await expect(win.locator("#libsub")).toContainText("20,000 photos");
  await expect(win.locator("#libsub")).toContainText("choose a year or event");
  await expect(win.locator(".tile img").first()).toBeVisible({ timeout: 30_000 });
  const openLibrary = Date.now() - t0;

  // Scroll to the bottom and back: pictures keep showing.
  const scroll = Date.now();
  await win.evaluate(async () => {
    const el = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 1000 && getComputedStyle(e).overflowY !== "visible") as HTMLElement;
    for (let i = 1; i <= 10; i++) {
      el.scrollTop = (el.scrollHeight * i) / 10;
      await new Promise((r) => setTimeout(r, 50));
    }
    el.scrollTop = 0;
  });
  const scrolled = Date.now() - scroll;

  // Search for one event.
  const s0 = Date.now();
  const found = (await win.evaluate(async () => (await (window as unknown as W).hub.call("search", "Event 42")).value)) as unknown;
  const search = Date.now() - s0;
  expect(JSON.stringify(found)).toContain("Event 42");

  // Every tab answers.
  const clicks: Record<string, number> = {};
  for (const tab of TABS) {
    const c0 = Date.now();
    await win.locator(`button.nav[data-go="${tab}"]`).click();
    await expect(win.locator(`button.nav.on[data-go="${tab}"]`)).toBeVisible();
    clicks[tab] = Date.now() - c0;
  }
  await app.close();

  const slowest = Math.max(...Object.values(clicks));
  console.log("huge-library", JSON.stringify({ photos: EVENTS * PER_EVENT, openLibrary, scrolled, search, slowestTab: slowest, clicks }));
  expect(errors).toEqual([]);
  expect(openLibrary).toBeLessThan(20_000);
  expect(search).toBeLessThan(2_000);
  expect(slowest).toBeLessThan(2_000);
});
