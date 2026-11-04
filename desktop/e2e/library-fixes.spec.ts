import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Robot checks for the 0.4 fixes that don't need real faces:
// B-05 "A new event…" made a new event (not the first in the list),
// B-06 sidebar clicks work while "My albums" is folded shut,
// B-08 an edited copy and an exact copy move with their photo,
// B-10 a photo whose file is gone shows a clear note, not a broken image,
// B-19 closing the app gives no error.
const root = path.join(__dirname, "..");

async function jpeg(file: string, seed: number) {
  const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: (seed * 47) % 255, g: (seed * 89) % 255, b: (seed * 31) % 255 } } })
    .composite([{ input: Buffer.from(`<svg width="640" height="480"><rect x="${(seed * 40) % 560}" y="40" width="60" height="400" fill="white"/></svg>`), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
  writeFileSync(file, img);
  return img;
}

async function makeLibrary() {
  const base = mkdtempSync(path.join(tmpdir(), "hub-lib-"));
  const lib = path.join(base, "Photos");
  const sports = path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day");
  const books = path.join(lib, "2025-2026", "Term 1", "2025-10-20 Book week");
  mkdirSync(sports, { recursive: true });
  mkdirSync(books, { recursive: true });
  const first = await jpeg(path.join(sports, "IMG_1000.jpg"), 1);
  for (let i = 1; i < 4; i++) await jpeg(path.join(sports, `IMG_100${i}.jpg`), i + 1);
  await jpeg(path.join(sports, "IMG_1000-edit.jpg"), 9);
  writeFileSync(path.join(sports, "IMG_1000 copy.jpg"), first);
  await jpeg(path.join(books, "IMG_2000.jpg"), 11);
  await jpeg(path.join(books, "IMG_2001.jpg"), 12);
  return { lib, sports, books };
}

async function launch(lib: string): Promise<{ app: ElectronApplication; win: Page; userData: string; log: string[] }> {
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const log: string[] = [];
  app.process().stderr?.on("data", (d) => log.push(String(d)));
  app.process().stdout?.on("data", (d) => log.push(String(d)));
  const win = await app.firstWindow();
  await win.locator('button.nav[data-go="library"]').click();
  await expect(win.locator("#grid .tile").first()).toBeVisible({ timeout: 60_000 });
  return { app, win, userData, log };
}

// Click the library tile showing this file.
async function clickPhoto(win: Page, name: string) {
  const i = await win.evaluate(`lib.shown.findIndex((p) => p.name === ${JSON.stringify(name)})`);
  expect(i).toBeGreaterThanOrEqual(0);
  const tile = win.locator(`#grid .tile[data-i="${i}"]`);
  await tile.click();
  return tile;
}

function findDir(dir: string, ending: string): string | null {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (!statSync(p).isDirectory()) continue;
    if (e.endsWith(ending)) return p;
    const deeper = findDir(p, ending);
    if (deeper) return deeper;
  }
  return null;
}

test("B-05 + B-08: move to a new event takes the edited and exact copies along", async () => {
  test.setTimeout(120_000);
  const { lib, sports, books } = await makeLibrary();
  const { app, win } = await launch(lib);
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);

  await clickPhoto(win, "IMG_1000.jpg");
  await win.locator('#selbar [data-a="move"]').click();
  await expect(win.locator("#mv-ev")).toHaveValue("");
  await win.locator("#mv-title").fill("Science fair");
  await expect(win.locator("#mv-where")).toContainText("Science fair");
  await win.locator("#mv-yes").click();

  await expect.poll(() => (existsSync(lib) ? findDir(lib, " Science fair") : null), { timeout: 20_000 }).not.toBeNull();
  const fair = findDir(lib, " Science fair")!;
  await expect.poll(() => readdirSync(fair).sort(), { timeout: 20_000 }).toEqual(["IMG_1000 copy.jpg", "IMG_1000-edit.jpg", "IMG_1000.jpg"]);
  // Nothing left behind, and the first event in the list got nothing.
  expect(readdirSync(sports).sort()).toEqual(["IMG_1001.jpg", "IMG_1002.jpg", "IMG_1003.jpg"]);
  expect(readdirSync(books).sort()).toEqual(["IMG_2000.jpg", "IMG_2001.jpg"]);
  await app.close();
});

test("B-06: the sidebar works with My albums folded shut", async () => {
  test.setTimeout(120_000);
  const { lib } = await makeLibrary();
  const { app, win } = await launch(lib);
  const mine = win.locator('#tree [data-sec="mine"]');
  await mine.click();
  await expect(mine).toHaveClass(/shut/);
  await expect(win.locator("#newalbum")).toHaveCount(0);
  await win.locator("#tree .t", { hasText: "Book week" }).first().click();
  await expect(win.locator("#libsub")).toContainText("2 photos", { timeout: 10_000 });
  await mine.click();
  await expect(mine).not.toHaveClass(/shut/);
  await app.close();
});

test("B-10 + B-19: missing original shows a note; closing gives no error", async () => {
  test.setTimeout(120_000);
  const { lib, books } = await makeLibrary();
  const { app, win, log } = await launch(lib);
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  // Wait until every photo has its small copy, then delete one original.
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 30_000 }).toBe(6);
  rmSync(path.join(books, "IMG_2000.jpg"));
  await win.evaluate(() => (window as unknown as { hub: { call: (f: string) => Promise<unknown> } }).hub.call("rescan"));
  await expect(win.locator("#missingbar")).toContainText("1 photo is missing", { timeout: 30_000 });

  await win.locator('#tree [data-album="missing"]').click();
  await expect(win.locator("#libsub")).toContainText("1 photo", { timeout: 10_000 });
  await (await clickPhoto(win, "IMG_2000.jpg")).dblclick();
  const viewer = win.locator("#overlay");
  await expect(win.locator("#v-miss")).toBeVisible({ timeout: 10_000 });
  await expect(win.locator("#v-miss")).toContainText("The original isn't on this computer now");
  // No broken picture: every image in the viewer actually loaded.
  const broken = await viewer.locator("img").evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0 && (i as HTMLImageElement).getAttribute("src")).length);
  expect(broken).toBe(0);
  await win.screenshot({ path: test.info().outputPath("missing-viewer.png") });

  await app.close();
  expect(log.join("")).not.toMatch(/Object has been destroyed|Uncaught|UnhandledPromiseRejection/);
  expect(errors).toEqual([]);
});

test("B-11: photos from a deleted folder can be imported again", async () => {
  test.setTimeout(120_000);
  const { lib, books } = await makeLibrary();
  const card = path.join(path.dirname(lib), "Card", "DCIM");
  cpSync(books, card, { recursive: true });
  const { app, win } = await launch(lib);
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 30_000 }).toBe(6);
  rmSync(books, { recursive: true, force: true });
  await win.evaluate(() => (window as unknown as { hub: { call: (f: string) => Promise<unknown> } }).hub.call("rescan"));
  await expect(win.locator("#missingbar")).toContainText("2 photos are missing", { timeout: 30_000 });

  await win.locator('button.nav[data-go="import"]').click();
  await win.evaluate((dir) => (window as unknown as { go: (v: string, p: object) => void }).go("import", { sources: [dir] }), card);
  await expect(win.locator(".ibar")).toBeVisible({ timeout: 60_000 });
  // Not "imported before": both are offered and ticked.
  await expect(win.locator("#i-count")).toContainText("2 photos ticked");
  await expect(win.locator("#imp")).not.toContainText("imported before");
  await app.close();
});
