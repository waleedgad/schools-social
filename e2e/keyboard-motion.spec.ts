import { expect, test } from "@playwright/test";
import { newSchool } from "./helpers";

// 0.14 design and accessibility (WCAG 2.2 AA 2.4.7 focus visible, 2.3.3
// motion): on/off switches show a focus ring when reached with the keyboard
// (the real checkbox is hidden, so it showed nothing before), and the
// computer's "reduce motion" setting stops movement everywhere.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

test("switches show a focus ring from the keyboard", async ({ page }) => {
  await newSchool(page, "focus");
  await page.goto("/en/settings");
  const box = page.locator("input.peer.sr-only").first();
  await expect(box).toBeAttached();
  await page.keyboard.press("Tab");
  await box.focus();
  const ring = await box.evaluate((el) => getComputedStyle(el.nextElementSibling as Element).outlineStyle);
  expect(ring).not.toBe("none");
});

test("reduce motion: nothing slides or fades", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await newSchool(page, "motion");
  await page.goto("/en/today");
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll("main, main *, aside *")].slice(0, 400).flatMap((el) => {
      const s = getComputedStyle(el);
      return [s.transitionDuration, s.animationDuration].flatMap((d) => d.split(",").map((x) => parseFloat(x) * (x.trim().endsWith("ms") ? 1 : 1000)));
    }),
  );
  expect(Math.max(...durations)).toBeLessThanOrEqual(1);
});
