import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newSchool } from "./helpers";

// Accessibility (WCAG 2.2 AA, the world standard): every page is checked by
// axe, the tool used by accessibility auditors, for things like missing
// labels, low contrast, missing page language, buttons with no name and
// headings out of order, in both languages and on phone and computer.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const signedOut = ["login", "signup", "forgot"];
const signedIn = [
  "today", "library", "upload", "posts", "posts/new", "posts/new/announcement", "calendar",
  "inbox", "coverage", "students", "staff", "albums", "books", "shots", "categories",
  "analytics", "reports", "activity", "accounts", "settings", "help", "setup", "check",
];

async function check(page: Page, where: string, found: string[]) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  for (const v of r.violations) found.push(`${where}: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.html.slice(0, 160)}`);
}

for (const locale of ["en", "ar"] as const) {
  test(`accessibility: pages before sign-in (${locale})`, async ({ page }) => {
    const found: string[] = [];
    for (const p of signedOut) {
      await page.goto(`/${locale}/${p}`);
      await check(page, p, found);
    }
    expect(found).toEqual([]);
  });

  test(`accessibility: every signed-in page (${locale})`, async ({ page }, info) => {
    test.setTimeout(240_000);
    await newSchool(page, `a11y-${info.project.name}-${locale}`);
    const found: string[] = [];
    for (const p of signedIn) {
      await page.goto(`/${locale}/${p}`);
      await page.waitForLoadState("networkidle");
      await check(page, p, found);
    }
    expect(found).toEqual([]);
  });
}
