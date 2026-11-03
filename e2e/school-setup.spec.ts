import { expect, test } from "@playwright/test";
import { newSchool } from "./helpers";

// A new comms lead signs up, creates the school and lands on Today.
// Needs the local test database (npx supabase start); skipped without it.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

test("sign up and create a school", async ({ page }, info) => {
  await newSchool(page, info.project.name);
  await expect(page.locator("body")).toContainText("Al Nour Test School");
});
