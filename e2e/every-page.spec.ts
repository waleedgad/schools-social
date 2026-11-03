import { expect, test } from "@playwright/test";
import { newSchool, watchErrors } from "./helpers";

// Every page a signed-in comms lead can reach opens cleanly in both
// languages: no error page, no untranslated text, nothing wider than the
// screen, no errors in the browser.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const pages = [
  "today", "library", "upload", "posts", "posts/new", "posts/new/announcement", "calendar",
  "inbox", "coverage", "students", "staff", "albums", "books", "shots", "categories",
  "analytics", "reports", "activity", "accounts", "settings", "help", "setup", "check",
];

for (const locale of ["en", "ar"] as const) {
  test(`every page opens (${locale})`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await newSchool(page, `${info.project.name}-${locale}`);
    const problems: string[] = [];
    for (const path of pages) {
      const errors = watchErrors(page);
      const res = await page.goto(`/${locale}/${path}`);
      const status = res?.status() ?? 0;
      if (status >= 400) problems.push(`${path}: HTTP ${status}`);
      const text = await page.locator("body").innerText();
      if (/Application error|Internal Server Error|This page could not be found/i.test(text)) problems.push(`${path}: error page`);
      const keys = text.match(/\b[a-z][a-zA-Z]+\.[a-z][a-zA-Z]+(\.[a-zA-Z]+)*\b/g)?.filter((k) => !/\.(com|net|local|png|jpe?g|app)$/.test(k));
      if (keys?.length) problems.push(`${path}: untranslated ${keys.slice(0, 3).join(", ")}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${path}: ${overflow}px wider than the screen`);
      if (errors.length) problems.push(`${path}: ${errors[0].slice(0, 160)}`);
      await page.screenshot({ path: info.outputPath(`${locale}-${path.replace(/\//g, "-")}.png`), fullPage: true });
    }
    expect(problems).toEqual([]);
  });
}
