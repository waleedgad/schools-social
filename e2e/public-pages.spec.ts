import { expect, test, type Page } from "@playwright/test";

// Pages anyone can open without signing in, in both languages.
const locales = [
  { locale: "en", dir: "ltr" },
  { locale: "ar", dir: "rtl" },
] as const;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

for (const { locale, dir } of locales) {
  test.describe(locale, () => {
    for (const path of ["login", "signup"]) {
      test(`${path} opens cleanly`, async ({ page }) => {
        const errors = watchErrors(page);
        const res = await page.goto(`/${locale}/${path}`);
        expect(res?.status()).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("dir", dir);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        // No untranslated message keys (next-intl shows them as "Namespace.key").
        await expect(page.locator("body")).not.toContainText(/\b[A-Z][a-zA-Z]+\.[a-z][a-zA-Z]+\b/);
        // Nothing wider than the screen.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      });
    }

    for (const path of ["today", "library", "posts", "calendar", "settings"]) {
      test(`${path} sends signed-out visitors to sign in`, async ({ page }) => {
        await page.goto(`/${locale}/${path}`);
        await expect(page).toHaveURL(new RegExp(`/${locale}/login`));
      });
    }
  });
}
