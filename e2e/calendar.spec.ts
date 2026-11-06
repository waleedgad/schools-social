import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { watchErrors } from "./helpers";

// Release 0.8, item 5 (website): moving a post on the calendar keeps its
// time of day in the school's time zone (Cairo), days off and holidays are
// marked, and dropping a post on one asks first.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "drag and drop needs a mouse"));
test.use({ timezoneId: "Africa/Cairo" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });

async function signIn(page: Page, email: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).not.toHaveURL(/\/en\/login/, { timeout: 20_000 });
}

test("move a post to another day; days off ask first", async ({ page }) => {
  test.setTimeout(120_000);
  // A month well ahead, so every day in it is still in the future.
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  const ym = month.toISOString().slice(0, 7);
  const day = (n: number) => `${ym}-${String(n).padStart(2, "0")}`;
  const weekdayOf = (k: string) => new Date(`${k}T12:00:00Z`).getUTCDay();
  // Find a Sunday-to-Thursday school day for each step (Friday is off).
  const schoolDays = Array.from({ length: 28 }, (_, i) => day(i + 1)).filter((k) => weekdayOf(k) !== 5 && weekdayOf(k) !== 6);
  const [from, to, holiday] = [schoolDays[2], schoolDays[4], schoolDays[8]];
  const friday = Array.from({ length: 28 }, (_, i) => day(i + 1)).find((k) => weekdayOf(k) === 5)!;

  const { data: school } = await admin()
    .from("schools")
    .insert({ name: "Calendar school", timezone: "Africa/Cairo", no_post_days: { weekdays: [5], holidays: true }, holidays: [{ name: "Mid-year break", start: holiday, end: holiday }] })
    .select("id")
    .single();
  const schoolId = school!.id as string;
  const email = `cal-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const { data: u } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  await admin().from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role: "comms_lead", full_name: "Lead" });
  // 7:30 pm in Cairo (17:30 UTC in winter, 16:30 in summer): ask the
  // database to work it out the same way the site does.
  const cairo = (k: string) => new Date(`${k}T19:30:00${new Intl.DateTimeFormat("en", { timeZone: "Africa/Cairo", timeZoneName: "longOffset" }).format(new Date(`${k}T12:00:00Z`)).split("GMT")[1] || "+02:00"}`).toISOString();
  const { data: p } = await admin()
    .from("posts")
    .insert({ school_id: schoolId, created_by: u.user!.id, status: "draft", platforms: ["facebook"], caption_en: "Science fair photos", scheduled_at: cairo(from) })
    .select("id")
    .single();
  const at = async () => (await admin().from("posts").select("scheduled_at").eq("id", p!.id).single()).data!.scheduled_at as string;
  const errors = watchErrors(page);

  await signIn(page, email);
  await page.goto(`/en/calendar?month=${ym}`);
  const cell = (k: string) => page.locator(`[data-day="${k}"]`);
  const post = page.locator(`a[href$="/posts/${p!.id}"]`).first();
  await expect(cell(from)).toContainText("Science fair photos");
  await expect(cell(holiday)).toContainText("Mid-year break");
  await expect(cell(friday)).toContainText("No posting");

  // 1. Drag to another school day: same time of day, in Cairo.
  await post.dragTo(cell(to));
  await expect.poll(async () => new Date(await at()).toISOString()).toBe(cairo(to));
  await expect(cell(to)).toContainText("Science fair photos");

  // 2. Drop on the holiday: it asks; saying no leaves it where it was.
  page.once("dialog", (d) => {
    expect(d.message()).toContain("Mid-year break");
    void d.dismiss();
  });
  await post.dragTo(cell(holiday));
  await page.waitForTimeout(1500);
  expect(new Date(await at()).toISOString()).toBe(cairo(to));
  // Saying yes puts it there.
  page.once("dialog", (d) => void d.accept());
  await post.dragTo(cell(holiday));
  await expect.poll(async () => new Date(await at()).toISOString()).toBe(cairo(holiday));
  expect(errors).toEqual([]);
});
