import { expect, test } from "@playwright/test";
import { newSchool, watchErrors } from "./helpers";

// Every page a signed-in comms lead can reach opens cleanly in both
// languages: no error page, no untranslated text, nothing wider than the
// screen, no errors in the browser.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

// Words that stay in English on Arabic screens: names of products, the
// school's own test data, file types and keys.
const KEEP = /School Social Hub|English|[A-Z][a-z]+\/[A-Z][A-Za-z_]+|Al Nour Test School|Facebook|Instagram|WhatsApp|Slack|Microsoft Teams|Teams|Google|Microsoft|OneDrive|Drive|Excel|CSV|PowerSchool|Classera|Edunation|Gemini|Meta|Supabase|Vercel|xlsx|PNG|JPE?G|HEIC|RAW|PDF|Cmd|Ctrl|Shift|Enter|Esc|Test|Lead|\S+@\S+|https?:\/\/\S+|[\w.-]+\.(com|net|app)\b|\b(IG|FB|AI|KG\d?|G\d+[A-Z]?|AM|PM|EN|AR|OK)\b/g;
function englishOnArabic(text: string) {
  return text
    .split("\n")
    .map((l) => l.replace(KEEP, "").trim())
    .filter((l) => /[A-Za-z]{3,}/.test(l))
    .map((l) => l.slice(0, 60));
}

const pages = [
  "today", "library", "upload", "posts", "posts/new", "posts/new/announcement", "calendar",
  "inbox", "coverage", "students", "staff", "albums", "books", "shots", "categories",
  "analytics", "digest", "reports", "activity", "accounts", "settings", "help", "setup", "check",
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
      if (locale === "ar") {
        const english = englishOnArabic(text);
        if (english.length) problems.push(`${path}: English on the Arabic page: ${english.slice(0, 4).join(" | ")}`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${path}: ${overflow}px wider than the screen`);
      if (errors.length) problems.push(`${path}: ${errors[0].slice(0, 160)}`);
      await page.screenshot({ path: info.outputPath(`${locale}-${path.replace(/\//g, "-")}.png`), fullPage: true, caret: "initial" });
    }
    expect(problems).toEqual([]);
  });
}
