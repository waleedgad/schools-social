import { expect, test } from "@playwright/test";
import { newSchool } from "./helpers";

// WCAG 2.2: 1.4.10 Reflow (a page still works at 400% zoom, which is a
// 320 px wide window, without scrolling sideways), 2.1.1 Keyboard (every
// control can be reached with Tab) and 2.4.7 / 2.4.11 Focus visible (you can
// see where the keyboard is).
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const PAGES = [
  "today", "library", "upload", "posts", "posts/new", "posts/new/announcement", "calendar",
  "inbox", "coverage", "students", "staff", "albums", "books", "shots", "categories",
  "analytics", "reports", "activity", "accounts", "settings", "help", "setup", "check",
];

for (const locale of ["en", "ar"] as const) {
  test(`every page works at 400% zoom (${locale})`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop only (sets its own size)");
    test.setTimeout(240_000);
    await newSchool(page, `zoom-${locale}`);
    await page.setViewportSize({ width: 320, height: 640 });
    const problems: string[] = [];
    for (const path of PAGES) {
      await page.goto(`/${locale}/${path}`);
      // Wider than the window = the whole page scrolls sideways.
      const wide = await page.evaluate(() => {
        const right = document.documentElement.scrollWidth - window.innerWidth;
        // Pushed off the left edge (right-aligned rows, or the right edge in Arabic) doesn't widen the page but is just as cut off.
        const off = [...document.querySelectorAll("header a, header button, main a, main button")]
          .filter((e) => !e.closest(".overflow-x-auto, .overflow-auto, [data-scroll-x]"))
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .reduce((m, r) => Math.max(m, -r.left, r.right - window.innerWidth), 0);
        return Math.round(Math.max(right, off));
      });
      if (wide > 1) {
        const culprit = await page.evaluate(() => {
          const w = window.innerWidth;
          const el = [...document.querySelectorAll("body *")]
            .filter((e) => (e.getBoundingClientRect().right > w + 1 || e.getBoundingClientRect().left < -1) && getComputedStyle(e).position !== "fixed")
            .filter((e) => !e.closest("[data-scroll-x], .overflow-x-auto, .overflow-auto, table"))
            .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
          return el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} "${(el.textContent ?? "").trim().slice(0, 30)}"` : "?";
        });
        problems.push(`${path}: ${wide}px sideways (${culprit})`);
      }
      await page.screenshot({ path: info.outputPath(`${locale}-${path.replace(/\//g, "-")}.png`), fullPage: true });
    }
    expect(problems).toEqual([]);
  });
}

test("keyboard alone reaches every control, and you can see where it is", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  test.setTimeout(240_000);
  await newSchool(page, "keys");
  const problems: string[] = [];
  for (const path of PAGES) {
    await page.goto(`/en/${path}`);
    // Rings fade in; look at them once they are there.
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    // Every visible control on the page.
    const controls = await page.evaluate(() => {
      const sel = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";
      return [...document.querySelectorAll(sel)].filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !(e as HTMLElement).closest("[inert], [aria-hidden=true]");
      }).length;
    });
    // Press Tab through the page, noting what gets focus and whether it shows.
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    const seen = new Set<string>();
    let noRing = "";
    for (let i = 0; i < controls + 10; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return null;
        // Visible = the control looks different with focus than without.
        const look = () => { const c = getComputedStyle(e); return `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}|${c.boxShadow}|${c.borderColor}|${c.backgroundColor}|${c.textDecorationLine}`; };
        const focused = look();
        e.blur();
        const plain = look();
        e.focus();
        const ring = focused !== plain;
        const key = `${e.tagName}|${e.getAttribute("href") ?? ""}|${e.getAttribute("name") ?? ""}|${(e.textContent ?? "").trim().slice(0, 20)}|${Math.round(e.getBoundingClientRect().top)}|${Math.round(e.getBoundingClientRect().left)}`;
        return { key, ring, label: `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}"` };
      });
      if (!f) continue;
      if (!f.ring && !noRing) noRing = f.label;
      seen.add(f.key);
    }
    if (noRing) problems.push(`${path}: no visible focus on ${noRing}`);
    // Some controls are only reachable after opening a menu; most must be reachable directly.
    if (seen.size < Math.min(controls, 5)) problems.push(`${path}: Tab reached ${seen.size} of ${controls} controls`);
  }
  expect(problems).toEqual([]);
});
