import { _electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Windows (release 0.7): the keys and words are Windows' own. On Windows
// (and Linux) Ctrl does what ⌘ does on the Mac: Ctrl+K search, Ctrl+1..5 to
// switch screens, Ctrl+, settings, Ctrl+I import. No screen says ⌘ or
// Finder there. On the Mac, ⌘ still works and is what it says.
const TABS = ["today", "library", "import", "faces", "students", "coverage", "cleanup", "books", "posts", "calendar", "history", "settings", "help"];
const root = path.join(__dirname, "..");
const mac = process.platform === "darwin";
const mod = mac ? "Meta" : "Control";

for (const language of ["en", "ar"] as const) {
  test(`keys and words fit the computer (${language})`, async () => {
    test.setTimeout(180_000);
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language, setupDone: true, tourDone: true, wizard: true }));
    const app = await _electron.launch({
      executablePath: require("electron") as unknown as string,
      args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    });
    const win = await app.firstWindow();
    await expect(win.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr", { timeout: 20_000 });
    const view = () => win.evaluate("App.view");

    // Screens by number, settings, import.
    for (const [key, name] of [["2", "library"], ["3", "faces"], ["4", "students"], ["5", "posts"], ["1", "today"], [",", "settings"], ["i", "import"]]) {
      await win.locator("body").press(`${mod}+${key}`);
      await expect.poll(view, { message: `${mod}+${key}` }).toBe(name);
    }
    // Search.
    await win.locator("body").press(`${mod}+k`);
    await expect(win.locator(".palette input")).toBeVisible();
    await win.keyboard.press("Escape");

    // The words on every screen and in the shortcut list.
    const wrong = mac ? /Ctrl\+|File Explorer|مستكشف الملفات/ : /⌘|Finder/;
    const problems: string[] = [];
    for (const tab of TABS) {
      await win.locator(`button.nav[data-go="${tab}"]`).click();
      await win.waitForTimeout(400);
      const text = await win.locator("body").innerText();
      const hit = text.match(wrong);
      if (hit) problems.push(`${tab}: "${text.slice(Math.max(0, hit.index! - 30), hit.index! + 20).replace(/\n/g, " ")}"`);
    }
    await win.locator(`button.nav[data-go="today"]`).click();
    await win.keyboard.press("?");
    await expect(win.locator(".keysheet").first()).toBeVisible();
    const sheet = await win.locator("#overlay").innerText();
    if (wrong.test(sheet)) problems.push(`shortcut list: ${sheet.match(wrong)![0]}`);
    expect(sheet).toContain(mac ? "⌘" : "Ctrl+");
    expect(problems).toEqual([]);
    await app.close();
  });
}
