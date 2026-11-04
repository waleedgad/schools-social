import { _electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// WCAG 2.2 for the Mac app: with the largest text size in the smallest
// window nothing is cut off (1.4.4, 1.4.10), and the keyboard alone reaches
// every control with a visible focus (2.1.1, 2.4.7).
const TABS = ["today", "library", "import", "faces", "students", "coverage", "cleanup", "books", "posts", "calendar", "history", "settings", "help"];
const root = path.join(__dirname, "..");

async function open(language: "en" | "ar") {
  const base = mkdtempSync(path.join(tmpdir(), "hub-keys-"));
  const lib = path.join(base, "Photos");
  const ev = path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  for (let i = 0; i < 4; i++) {
    const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 50 * i, g: 130, b: 190 } } }).jpeg().toBuffer();
    writeFileSync(path.join(ev, `IMG_${5000 + i}.jpg`), img);
  }
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language, textSize: "large", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  // The smallest the window can be.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 640));
  await expect(win.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr", { timeout: 20_000 });
  await win.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { app, win };
}

const cutOff = (win: Page) =>
  win.evaluate(() => {
    const w = window.innerWidth;
    const found: string[] = [];
    if (document.documentElement.scrollWidth > w + 1) found.push(`window ${document.documentElement.scrollWidth - w}px wider`);
    for (const e of document.querySelectorAll("button, a, input, select, label")) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(e).visibility === "hidden") continue;
      // Inside something that scrolls sideways on purpose (a strip of photos) is fine.
      let p = e.parentElement;
      let scrolls = false;
      while (p) {
        const o = getComputedStyle(p).overflowX;
        if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) scrolls = true;
        p = p.parentElement;
      }
      if (scrolls) continue;
      if (r.left < -1 || r.right > w + 1) found.push(`${e.tagName.toLowerCase()} "${(e.textContent ?? "").trim().slice(0, 25)}" off the edge`);
      // A button whose words don't fit in it.
      if (e.tagName === "BUTTON" && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).textOverflow !== "ellipsis") found.push(`button "${(e.textContent ?? "").trim().slice(0, 25)}" text doesn't fit`);
    }
    return found.slice(0, 3);
  });

for (const language of ["en", "ar"] as const) {
  test(`large text in the smallest window: nothing cut off (${language})`, async () => {
    test.setTimeout(240_000);
    const { app, win } = await open(language);
    await expect(win.locator("html")).toHaveAttribute("data-size", "large");
    const problems: string[] = [];
    for (const tab of TABS) {
      await win.locator(`button.nav[data-go="${tab}"]`).click();
      await expect(win.locator(`button.nav.on[data-go="${tab}"]`)).toBeVisible();
      await win.waitForTimeout(600);
      for (const p of await cutOff(win)) problems.push(`${tab}: ${p}`);
      await win.screenshot({ path: test.info().outputPath(`${language}-${tab}.png`) });
    }
    await app.close();
    expect(problems).toEqual([]);
  });
}

test("keyboard alone: reach every control with a visible focus, and change tabs", async () => {
  test.setTimeout(240_000);
  const { app, win } = await open("en");
  const problems: string[] = [];
  for (const tab of TABS) {
    await win.locator(`button.nav[data-go="${tab}"]`).click();
    await expect(win.locator(`button.nav.on[data-go="${tab}"]`)).toBeVisible();
    await win.waitForTimeout(500);
    let noRing = "";
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await win.keyboard.press("Tab");
      const f = await win.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return null;
        const look = () => {
          const c = getComputedStyle(e);
          return `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}|${c.boxShadow}|${c.borderColor}|${c.backgroundColor}`;
        };
        const focused = look();
        e.blur();
        const plain = look();
        e.focus();
        return { key: `${e.tagName}|${e.className}|${(e.textContent ?? "").trim().slice(0, 20)}|${Math.round(e.getBoundingClientRect().top)}`, ring: focused !== plain, label: `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}"` };
      });
      if (!f) continue;
      seen.add(f.key);
      if (!f.ring && !noRing) noRing = f.label;
    }
    if (noRing) problems.push(`${tab}: no visible focus on ${noRing}`);
    if (seen.size < 3) problems.push(`${tab}: Tab reached only ${seen.size} controls`);
  }
  // A tab can be opened from the keyboard.
  await win.locator('button.nav[data-go="students"]').focus();
  await win.keyboard.press("Enter");
  await expect(win.locator('button.nav.on[data-go="students"]')).toBeVisible();
  await app.close();
  expect(problems).toEqual([]);
});
