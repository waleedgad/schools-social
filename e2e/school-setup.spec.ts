import { expect, test } from "@playwright/test";

// A new comms lead signs up, creates the school and lands on Today.
// Needs the local test database (npx supabase start); skipped without it.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

test("sign up and create a school", async ({ page }, info) => {
  const email = `lead-${info.project.name}-${Date.now()}@test.local`;
  await page.goto("/en/signup");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill("Test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/en\/onboarding/);
  await page.getByLabel(/school name/i).fill("Al Nour Test School");
  await page.getByLabel(/full name/i).fill("Test Lead");
  await page.getByRole("button", { name: "Create school" }).click();

  await expect(page).toHaveURL(/\/en\/(today|setup)/);
  await expect(page.locator("body")).toContainText("Al Nour Test School");
});
