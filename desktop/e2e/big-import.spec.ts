import { _electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// B-01: a big folder (Waleed's had 711 photos) made the Import preview go
// blank with black areas and old thumbnails. Now each event shows its first
// 200 photos with "Show all", ticking one photo only redraws that tile, and
// leaving Import lets go of the thumbnails.
const root = path.join(__dirname, "..");
const COUNT = 800;

test("import preview stays usable with 800 photos", async () => {
  test.setTimeout(300_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-big-"));
  const lib = path.join(base, "Photos");
  const src = path.join(base, "Card", "DCIM");
  mkdirSync(lib, { recursive: true });
  mkdirSync(src, { recursive: true });
  for (let i = 0; i < COUNT; i++) {
    // Varied colours and a stripe so none look blank or blurry.
    const img = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: (i * 37) % 255, g: (i * 91) % 255, b: (i * 53) % 255 } } })
      .composite([{ input: Buffer.from(`<svg width="320" height="240"><rect x="${i % 280}" y="20" width="30" height="200" fill="white"/><text x="20" y="120" font-size="40">${i}</text></svg>`), top: 0, left: 0 }])
      .jpeg()
      .toBuffer();
    writeFileSync(path.join(src, `IMG_${String(i).padStart(4, "0")}.jpg`), img);
  }
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));

  await win.locator('button.nav[data-go="import"]').click();
  await win.evaluate((dir) => (window as unknown as { go: (v: string, p: object) => void }).go("import", { sources: [dir] }), src);
  await expect(win.locator(".ibar")).toBeVisible({ timeout: 240_000 });

  // At most 200 tiles per event on the page, with a "Show all" button.
  const tiles = await win.locator(".itile").count();
  const events = await win.locator("[data-evall]").count();
  expect(tiles).toBeLessThanOrEqual(events * 200);
  await expect(win.locator("#i-count")).toContainText(`${COUNT} photos ticked`);
  await expect(win.locator("[data-showall]").first()).toBeVisible();

  // Ticking one photo updates the numbers without redrawing the page.
  const first = win.locator(".itile").first();
  await first.evaluate((el) => ((el as HTMLElement & { marker?: boolean }).dataset.marker = "1"));
  await first.click();
  await expect(win.locator("#i-count")).toContainText(`${COUNT - 1} photos ticked`);
  await expect(win.locator("#i-go")).toContainText(`Import ${COUNT - 1} photos`);
  await expect(win.locator('.itile[data-marker="1"]')).toHaveClass(/off/);
  await first.click();
  await expect(win.locator("#i-count")).toContainText(`${COUNT} photos ticked`);

  // Show all puts every photo of that event on the page.
  await win.locator("[data-showall]").first().click();
  expect(await win.locator(".itile").count()).toBeGreaterThan(tiles);

  // Scroll to the bottom: the thumbnails there have loaded.
  await win.locator(".itile").last().scrollIntoViewIfNeeded();
  await expect(win.locator(".itile img").last()).toHaveJSProperty("complete", true, { timeout: 30_000 });
  await win.screenshot({ path: test.info().outputPath("big-import-bottom.png") });

  // Leaving Import clears the preview from the screen.
  await win.locator('button.nav[data-go="library"]').click();
  await expect(win.locator(".itile")).toHaveCount(0);
  expect(errors).toEqual([]);
  await app.close();
});
