import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { newSchool, watchErrors } from "./helpers";

// "Make a week of posts" (release 0.6): ideas only, never published; none on
// the school's no-posting days or holidays; none on a day that already has a
// post; one per day; pressing it twice adds nothing the second time (B-46).
// Uses the AI's sample plan (no AI key in tests).
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const DAY = 86400_000;
const cairo = (at: Date | number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

test("make a week: open days only, never twice, never published", async ({ page }) => {
  test.setTimeout(90_000);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, "week");
  const errors = watchErrors(page);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await admin.from("memberships").select("school_id").eq("user_id", userId).single();
  const schoolId = m!.school_id as string;

  // Fridays and Saturdays off, a holiday in two days, a post already on the
  // next open school day after tomorrow's.
  const days = Array.from({ length: 21 }, (_, i) => cairo(Date.now() + i * DAY));
  const holiday = days[2];
  const open = days.filter((d, i) => i > 0 && ![5, 6].includes(weekday(d)) && d !== holiday);
  const busy = open[1];
  expect((await admin.from("schools").update({ no_post_days: { weekdays: [5, 6], holidays: true }, holidays: [{ name: "Test holiday", start: holiday, end: holiday }] }).eq("id", schoolId)).error).toBeNull();
  expect((await admin.from("posts").insert({ school_id: schoolId, status: "scheduled", caption_en: "Already planned", scheduled_at: `${busy}T15:00:00Z` })).error).toBeNull();
  const ideas = async () => ((await admin.from("posts").select("status, due_on, idea, scheduled_at").eq("school_id", schoolId).eq("status", "idea")).data ?? []) as { status: string; due_on: string; idea: string; scheduled_at: string | null }[];

  await page.goto("/en/posts");
  await page.getByRole("button", { name: "Make a week of posts" }).click();
  await expect(page).toHaveURL(/planned=\d+/);
  const made = await ideas();
  const count = Number(new URL(page.url()).searchParams.get("planned"));
  expect(count).toBeGreaterThan(0);
  expect(made).toHaveLength(count);
  await expect(page.locator("main")).toContainText(`${count} idea${count === 1 ? " was" : "s were"} added`);
  const dates = made.map((p) => p.due_on);
  expect(new Set(dates).size, "one idea per day").toBe(dates.length);
  for (const d of dates) {
    expect([5, 6], `${d} is a day off`).not.toContain(weekday(d));
    expect(d, "not on the holiday").not.toBe(holiday);
    expect(d, "not on the day that already has a post").not.toBe(busy);
    expect(d >= days[0] && d <= days[20], `${d} is in the coming weeks`).toBe(true);
  }
  // Ideas only: nothing scheduled, nothing published.
  expect(made.every((p) => p.scheduled_at === null && p.idea.length > 0)).toBe(true);
  const { count: live } = await admin.from("posts").select("id", { count: "exact", head: true }).eq("school_id", schoolId).in("status", ["scheduled", "publishing", "published"]);
  expect(live).toBe(1);

  // Again: those days are taken now, so nothing is added.
  await page.getByRole("button", { name: "Make a week of posts" }).click();
  await expect(page).toHaveURL(/planned=0/);
  await expect(page.locator("main")).toContainText("Every open day this week already has a post");
  expect(await ideas()).toHaveLength(count);
  expect(errors).toEqual([]);
});
