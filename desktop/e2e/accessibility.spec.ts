import { source as axeSource } from "axe-core";
import { _electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Accessibility (WCAG 2.2 AA) for the Mac app: every tab, in English and
// Arabic, light and dark, with a few photos in the library, checked by axe.
const TABS = ["today", "library", "import", "faces", "students", "coverage", "cleanup", "books", "posts", "calendar", "history", "settings", "help"];
const root = path.join(__dirname, "..");

for (const [language, theme] of [["en", "light"], ["ar", "light"], ["en", "dark"]] as const) {
  test(`accessibility: every tab (${language}, ${theme})`, async () => {
    test.setTimeout(240_000);
    const base = mkdtempSync(path.join(tmpdir(), "hub-a11y-"));
    const lib = path.join(base, "Photos");
    const ev = path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day");
    mkdirSync(ev, { recursive: true });
    for (let i = 0; i < 4; i++) {
      const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 50 * i, g: 130, b: 190 } } }).jpeg().toBuffer();
      writeFileSync(path.join(ev, `IMG_${5000 + i}.jpg`), img);
    }
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language, theme, setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
    const app = await _electron.launch({
      executablePath: require("electron") as unknown as string,
      args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
      env: { ...process.env, HUB_TEST: "1" },
    });
    const win = await app.firstWindow();
    await expect(win.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr", { timeout: 20_000 });
    const found: string[] = [];
    for (const tab of TABS) {
      await win.locator(`button.nav[data-go="${tab}"]`).click();
      await expect(win.locator(`button.nav.on[data-go="${tab}"]`)).toBeVisible();
      await win.waitForTimeout(900);
      // On Mac and Windows the window background is the system's see-through
      // material, which axe can't see; give it the matching solid colour.
      await win.addStyleTag({ content: ':root[data-platform] body { background: var(--bg) !important } :root[data-platform] #side { background: var(--sidesolid) !important }' });
      // axe runs inside the app window (the usual helper opens extra windows, which Electron doesn't allow).
      await win.evaluate(axeSource);
      const r = (await win.evaluate("axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })")) as { violations: { id: string; impact: string; nodes: { html: string }[] }[] };
      for (const v of r.violations) found.push(`${tab}: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.html.slice(0, 150)}`);
    }
    await app.close();
    expect(found).toEqual([]);
  });
}
