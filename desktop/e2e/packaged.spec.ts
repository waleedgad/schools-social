import { _electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Build check: the real, packaged app (what a school installs) starts, reads
// photos with its image engine and runs its face engine. Only runs when
// PACKAGED_APP points at the built program (the "package" job on GitHub).
const exe = process.env.PACKAGED_APP;
test.skip(!exe, "only on a packaged build");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };

test("the packaged app starts, reads photos and finds faces", async () => {
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-pkg-"));
  const ev = path.join(base, "Photos", "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  for (let i = 0; i < 3; i++) {
    const img = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 40 * i, g: 120, b: 180 } } }).jpeg().toBuffer();
    writeFileSync(path.join(ev, `IMG_${7000 + i}.jpg`), img);
  }
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: path.join(base, "Photos"), faces: true, faceVision: false }));
  const app = await _electron.launch({
    executablePath: exe!,
    args: [`--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(3);
  // Small pictures made (image engine works) and every photo looked at for faces (face engine loads).
  const done = () =>
    win.evaluate("Promise.all(lib.list.map((p) => window.hub.call('photo', p.id))).then((r) => r.map((x) => x.value ?? x).every((p) => p?.thumb === 1 && p?.faces_scanned === 1))");
  await expect.poll(done, { timeout: 120_000 }).toBe(true);
  // Every tab opens.
  for (const tab of ["today", "import", "faces", "students", "posts", "settings", "help"]) {
    await win.locator(`button.nav[data-go="${tab}"]`).click();
    await expect(win.locator(`button.nav.on[data-go="${tab}"]`)).toBeVisible();
  }
  const st = (await win.evaluate(() => (window as unknown as Hub).hub.call("state"))).value as { version: string };
  console.log("packaged app version", st.version);
  await win.screenshot({ path: test.info().outputPath("packaged.png") });
  await app.close();
  expect(errors).toEqual([]);
});
