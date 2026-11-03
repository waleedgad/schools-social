import { expect, type Page } from "@playwright/test";

// Signs up a brand-new comms lead and creates their school.
export async function newSchool(page: Page, tag: string) {
  const email = `lead-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.goto("/en/signup");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill("Test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/en\/onboarding/);
  await page.getByLabel(/school name/i).fill("Al Nour Test School");
  await page.getByLabel(/full name/i).fill("Test Lead");
  await page.getByRole("button", { name: "Create school" }).click();
  await expect(page).toHaveURL(/\/en\/(today|setup)/);
  return email;
}

// Collects page crashes and console errors while a test runs.
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
