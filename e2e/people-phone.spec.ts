import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { newSchool } from "./helpers";

// B-135: on a phone, a team member's Save / Turn off / Remove buttons on
// People ran past the card and the page scrolled sideways (English).
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "phone screen only"));

test("People fits a phone screen with a second team member", async ({ page }) => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, "people-phone");
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const me = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await admin.from("memberships").select("school_id").eq("user_id", me).single();
  const { data: other } = await admin.auth.admin.createUser({ email: `teacher-${Date.now()}@test.local`, password: "Test-password-123", email_confirm: true });
  await admin.from("memberships").insert({ school_id: m!.school_id, user_id: other.user!.id, role: "teacher", full_name: "Mariam Abdelrahman Mostafa" });
  for (const locale of ["en", "ar"]) {
    await page.goto(`/${locale}/staff`);
    await expect(page.getByText("Mariam Abdelrahman Mostafa")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, locale).toBeLessThanOrEqual(1);
  }
});
