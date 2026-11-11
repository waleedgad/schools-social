import { _electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Windows (release 0.7): the keys and words are Windows' own. On Windows
// (and Linux) Ctrl does what ⌘ does on the Mac: Ctrl+K search, Ctrl+1..5 to
// switch screens, Ctrl+, settings, Ctrl+I import. No screen says ⌘ or
// Finder or "this Mac" there. On the Mac, ⌘ still works and is what it says.
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
    // Keys pressed before the window has its first state do nothing, as for a person.
    await expect.poll(() => win.evaluate("!!S && !!document.querySelector('#side .nav')"), { timeout: 30_000 }).toBe(true);
    const view = () => win.evaluate("App.view");

    // Screens by number, settings, import.
    // On the Mac these keys belong to the app menu, which robot key presses
    // can't reach, so there the menu item that owns the key is clicked.
    for (const [key, name] of [["2", "library"], ["3", "faces"], ["4", "students"], ["5", "posts"], ["1", "today"], [",", "settings"], ["Shift+i", "import"]]) {
      if (mac) {
        const found = await app.evaluate(({ Menu, BrowserWindow }, acc) => {
          const walk = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
            for (const it of items) {
              if (String(it.accelerator ?? "").toLowerCase() === acc) return it;
              const sub = it.submenu && walk(it.submenu.items);
              if (sub) return sub;
            }
          };
          const item = walk(Menu.getApplicationMenu()?.items ?? []);
          if (item) item.click(undefined, BrowserWindow.getAllWindows()[0]);
          return !!item;
        }, `cmdorctrl+${key}`.toLowerCase());
        expect(found, `menu item for ⌘${key}`).toBe(true);
      } else {
        await win.locator("body").press(`${mod}+${key}`);
      }
      await expect.poll(view, { message: `${mod}+${key}` }).toBe(name);
    }
    // Search.
    await win.locator("body").press(`${mod}+k`);
    await expect(win.locator(".palette input")).toBeVisible();
    await win.keyboard.press("Escape");

    // The words on every screen and in the shortcut list.
    const wrong = mac ? /Ctrl\+|File Explorer|مستكشف الملفات/ : /⌘|Finder|\b[Tt](his|he) Mac\b|الماك/;
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
    // Thin scroll bars on Windows and Linux (no classic grey bar with arrows).
    if (!mac) {
      const widest = await win.evaluate(() =>
        Math.max(0, ...[...document.querySelectorAll<HTMLElement>("*")].filter((el) => el.scrollHeight > el.clientHeight + 1 && ["auto", "scroll"].includes(getComputedStyle(el).overflowY)).map((el) => el.offsetWidth - el.clientWidth - parseFloat(getComputedStyle(el).borderLeftWidth) - parseFloat(getComputedStyle(el).borderRightWidth))),
      );
      expect(widest, "scroll bar width").toBeLessThanOrEqual(10);
    }
    expect(problems).toEqual([]);
    await app.close();
  });
}
