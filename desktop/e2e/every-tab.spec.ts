import { _electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The robot opens the app with a fresh, empty library and clicks through
// every tab in English and Arabic, checking nothing crashes or overflows.
// A screenshot of each tab goes into the test report.
const TABS = ["today", "library", "import", "faces", "students", "coverage", "cleanup", "books", "posts", "calendar", "history", "settings", "help"];
const root = path.join(__dirname, "..");
// Words that stay in English on Arabic screens: product names, file types, keys.
const KEEP = /School Social Hub|-edit|English|Facebook|Instagram|WhatsApp|Slack|Microsoft Teams|Teams|Google|Microsoft|OneDrive|Drive|Excel|CSV|xlsx|PowerSchool|Classera|Edunation|Finder|Terminal|Applications|Replace|Return|Apple|Vision|PNG|JPE?G|HEIC|RAW|PDF|Cmd|Ctrl|Shift|Enter|Esc|Delete|Space|\S+@\S+|https?:\/\/\S+|[\w.-]+\.(com|net|app)\b|[\/~][\w./ -]*|\b(IG|FB|AI|KG\d?|G\d+[A-Z]?|AM|PM|EN|AR|OK|DCIM)\b|[⌘⇧⌥]\S*/g;
const englishOnArabic = (text: string) => text.split("\n").map((l) => l.replace(KEEP, "").trim()).filter((l) => /[A-Za-z]{3,}/.test(l)).map((l) => l.slice(0, 60));

for (const language of ["en", "ar"] as const) {
  test(`every tab opens (${language})`, async ({}, info) => {
    test.setTimeout(180_000);
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language, setupDone: true, tourDone: true, wizard: true }));
    const app = await _electron.launch({
      executablePath: require("electron") as unknown as string,
      args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    });
    const errors: string[] = [];
    const win = await app.firstWindow();
    win.on("pageerror", (e) => errors.push(e.message));
    win.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await expect(win.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr", { timeout: 20_000 });

    const problems: string[] = [];
    for (const tab of TABS) {
      const before = errors.length;
      await win.locator(`button.nav[data-go="${tab}"]`).click();
      await expect(win.locator(`button.nav.on[data-go="${tab}"]`)).toBeVisible();
      await win.waitForTimeout(700);
      const text = await win.locator("body").innerText();
      if (/undefined|NaN|\[object Object\]/.test(text)) problems.push(`${tab}: shows ${text.match(/undefined|NaN|\[object Object\]/)![0]}`);
      const overflow = await win.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${tab}: ${overflow}px wider than the window`);
      if (language === "ar") {
        const english = englishOnArabic(text);
        if (english.length) problems.push(`${tab}: English on the Arabic screen: ${english.slice(0, 5).join(" | ")}`);
      }
      if (errors.length > before) problems.push(`${tab}: ${errors.slice(before).join(" | ").slice(0, 200)}`);
      await win.screenshot({ path: info.outputPath(`${language}-${tab}.png`) });
    }
    await app.close();
    expect(problems).toEqual([]);
  });
}
