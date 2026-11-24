import { _electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 0.14 accessibility (WCAG 2.2 AA): on/off switches show the focus ring when
// reached with the keyboard (their checkbox is hidden, so nothing showed
// before), and the computer's "reduce motion" setting is followed even when
// the app's own Motion setting is left on Full.
const root = path.join(__dirname, "..");

test("switches show a focus ring; reduce motion stops movement", async () => {
  test.setTimeout(90_000);
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, motion: "full" }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
  });
  const win = await app.firstWindow();
  await expect(win.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 20_000 });
  await win.locator('button.nav[data-go="settings"]').click();
  const box = win.locator(".switch input").first();
  await expect(box).toBeAttached();
  await win.keyboard.press("Tab");
  await box.focus();
  const ring = await box.evaluate((el) => getComputedStyle(el.nextElementSibling as Element).outlineStyle);
  expect(ring).not.toBe("none");

  await win.emulateMedia({ reducedMotion: "reduce" });
  await win.locator('button.nav[data-go="today"]').click();
  const longest = await win.evaluate(() =>
    Math.max(...[...document.querySelectorAll("*")].slice(0, 600).flatMap((el) => {
      const s = getComputedStyle(el);
      return [s.transitionDuration, s.animationDuration].flatMap((d) => d.split(",").map((x) => parseFloat(x) * (x.trim().endsWith("ms") ? 1 : 1000)));
    })),
  );
  expect(longest).toBe(0);
  await app.close();
});
