import { _electron, expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Windows: opening the app a second time (a double click on the shortcut
// while it starts) must not start a second copy on the same library: the
// second copy stops by itself and the first one comes to the front.
const root = path.join(__dirname, "..");

test("a second copy of the app stops at once and the first one carries on", async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true }));
  const extra = process.platform === "linux" ? ["--no-sandbox"] : [];
  const app = await _electron.launch({ executablePath: require("electron") as unknown as string, args: [root, `--user-data-dir=${userData}`, ...extra], env: { ...process.env, HUB_TEST: "1" } });
  const win = await app.firstWindow();
  await expect(win.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());

  const t0 = Date.now();
  const second = spawn(require("electron") as unknown as string, [root, `--user-data-dir=${userData}`, ...extra], { env: { ...process.env, HUB_TEST: "1" }, stdio: "ignore" });
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => (second.kill(), resolve(-1)), 30_000);
    second.on("exit", (c) => (clearTimeout(timer), resolve(c)));
  });
  expect(code, "the second copy stopped by itself").toBe(0);
  expect(Date.now() - t0).toBeLessThan(30_000);
  // the first copy came back from the taskbar and still answers
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), { timeout: 10_000 }).toBe(false);
  await win.locator('button.nav[data-go="library"]').click();
  await expect(win.locator("#grid")).toBeVisible({ timeout: 15_000 });
  await app.close();
});
