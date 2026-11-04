import { _electron, expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// B-02: folders deleted in Finder. The Library says how many photos are
// missing and offers Find / On a drive / Forget; Settings can start a new
// library and keeps the old one archived.
const root = path.join(__dirname, "..");

async function makeLibrary() {
  const base = mkdtempSync(path.join(tmpdir(), "hub-lib-"));
  const lib = path.join(base, "Photos");
  const event = path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(event, { recursive: true });
  for (let i = 0; i < 6; i++) {
    const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 40 * i, g: 120, b: 200 - 20 * i } } }).jpeg().toBuffer();
    writeFileSync(path.join(event, `IMG_${1000 + i}.jpg`), img);
  }
  return { lib, event };
}

async function launch(userData: string) {
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  return { app, win: await app.firstWindow() };
}

async function openLibrary(win: Page) {
  await win.locator('button.nav[data-go="library"]').click();
}

test("deleted folder: notice, then forget them to the Bin", async () => {
  test.setTimeout(120_000);
  const { lib, event } = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const { app, win } = await launch(userData);
  await openLibrary(win);
  await expect(win.locator("#grid .tile, #grid [data-id]").first()).toBeVisible({ timeout: 60_000 });
  await expect(win.locator("#missingbar")).toBeEmpty();

  rmSync(event, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); // Windows: the app may be reading a photo for a moment
  await win.evaluate(() => (window as unknown as { hub: { call: (f: string) => Promise<unknown> } }).hub.call("rescan"));
  await expect(win.locator("#missingbar")).toContainText("6 photos are missing", { timeout: 30_000 });
  await expect(win.locator("#missingbar")).toContainText("Sports day");
  await win.screenshot({ path: test.info().outputPath("missing-notice.png") });

  await win.getByRole("button", { name: "Forget them" }).click();
  await win.getByRole("button", { name: "Move to Bin" }).click();
  await expect(win.locator("#missingbar")).toBeEmpty({ timeout: 15_000 });
  await app.close();
});

test("on a drive: the notice goes away until more go missing", async () => {
  test.setTimeout(120_000);
  const { lib, event } = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const { app, win } = await launch(userData);
  await openLibrary(win);
  await expect(win.locator("#grid .tile, #grid [data-id]").first()).toBeVisible({ timeout: 60_000 });
  rmSync(event, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); // Windows: the app may be reading a photo for a moment
  await win.evaluate(() => (window as unknown as { hub: { call: (f: string) => Promise<unknown> } }).hub.call("rescan"));
  await expect(win.locator("#missingbar")).toContainText("missing", { timeout: 30_000 });
  await win.getByRole("button", { name: "They're on a drive I'll plug in" }).click();
  await expect(win.locator("#missingbar")).toBeEmpty();
  await app.close();
});

test("start a new library keeps the old one archived", async () => {
  test.setTimeout(120_000);
  const { lib } = await makeLibrary();
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const { app, win } = await launch(userData);
  await openLibrary(win);
  await expect(win.locator("#grid .tile, #grid [data-id]").first()).toBeVisible({ timeout: 60_000 });
  await win.locator('button.nav[data-go="settings"]').click();
  await win.locator('[data-sp="library"]').click();
  await win.getByRole("button", { name: "Start new…" }).click();
  const closed = app.waitForEvent("close");
  await win.getByRole("button", { name: "Start new library" }).click();
  await closed;
  const archive = path.join(userData, "archived-libraries");
  expect(existsSync(archive)).toBe(true);
  expect(existsSync(path.join(archive, readdirSync(archive)[0], "library.db"))).toBe(true);
  // The photos on disk are untouched.
  expect(existsSync(lib)).toBe(true);

  // Next start: an empty library, asking where the photos are.
  const again = await launch(userData);
  await expect(again.win.locator("body")).toContainText(/No library folder|Choose/i, { timeout: 20_000 });
  expect(existsSync(path.join(userData, "start-new-library"))).toBe(false);
  const n = await again.win.evaluate(() => (window as unknown as { hub: { call: (f: string) => Promise<{ value: number }> } }).hub.call("missingCount"));
  expect(n.value).toBe(0);
  await again.app.close();
});
