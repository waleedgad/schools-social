import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { newSchool, watchErrors } from "./helpers";

// Scheduling and publishing (release 0.6), with no real Facebook Page:
// - not connected: Schedule and Publish now are off, with the reason shown;
// - connected: a scheduled post shows on its day in the calendar;
// - the Page is disconnected before the post is due: the scheduler marks it
//   failed with a clear reason, lists it on Today, never crashes, never tries
//   twice in one go;
// - posting paused: the queue waits untouched and Retry is off;
// - resumed and reconnected: the failed post can be scheduled again.
// Nothing here calls Facebook.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

test("schedule, lose the Facebook connection, pause and retry", async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, "publish");
  const errors = watchErrors(page);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await admin.from("memberships").select("school_id").eq("user_id", userId).single();
  const schoolId = m!.school_id as string;
  const connect = () => admin.from("meta_connections").upsert({ school_id: schoolId, page_id: "123456789", page_name: "Test Page", page_token: "not-a-real-token" });
  const status = async (id: string) => (await admin.from("posts").select("status, publish_error, attempts, scheduled_at").eq("id", id).single()).data!;
  const cron = () => request.post("/api/cron/publish", { headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {} });

  const write = async (about: string, ar: string, en: string) => {
    await page.goto("/en/posts/new");
    await page.getByLabel(/what is it about/i).fill(about);
    await page.getByRole("button", { name: /start writing/i }).click();
    await expect(page).toHaveURL(/\/en\/posts\/[0-9a-f-]+/);
    await page.getByLabel("Caption in Arabic").fill(ar);
    await page.getByLabel("Caption in English").fill(en);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
    return page.url().split("/").pop()!.split("?")[0];
  };
  const day = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const when = (hhmm: string) => page.locator('input[type="datetime-local"]').first().fill(`${day}T${hhmm}`);

  // 1. Not connected: the buttons are off and the page says why.
  const post = await write("Science fair next week", "معرض العلوم الأسبوع القادم", "Science fair next week");
  await expect(page.locator("main")).toContainText("Facebook and Instagram aren't connected yet");
  await expect(page.getByRole("button", { name: "Schedule", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish now" })).toBeDisabled();

  // 2. Connected: scheduled for next week, shown on its day in the calendar.
  await connect();
  await page.reload();
  await when("17:30");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page).toHaveURL(/done=schedule/);
  expect((await status(post)).status).toBe("scheduled");
  await page.goto(`/en/calendar?month=${day.slice(0, 7)}`);
  // On its day, in the school's own time zone (Cairo: 17:30 UTC is 19:30).
  await expect(page.locator("main")).toContainText("معرض العلوم الأسبوع القادم");

  // 3. The Page is disconnected, then the post is due: failed with the reason, team told.
  await admin.from("meta_connections").delete().eq("school_id", schoolId);
  await admin.from("posts").update({ scheduled_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", post);
  // Other tests leave overdue posts in the shared test database; run the
  // scheduler until it reaches this one.
  await expect.poll(async () => (expect((await cron()).status()).toBe(200), (await status(post)).status), { timeout: 60_000 }).toBe("failed");
  expect(await status(post)).toMatchObject({ status: "failed", attempts: 1 });
  expect((await status(post)).publish_error).toMatch(/Connect the school's Facebook Page/);
  // Today lists it as a problem to fix.
  await page.goto("/en/today");
  await expect(page.locator("main")).toContainText("معرض العلوم الأسبوع القادم");
  // A second run doesn't touch a failed post.
  expect((await cron()).status()).toBe(200);
  expect((await status(post)).attempts).toBe(1);
  await page.goto(`/en/posts/${post}`);
  await expect(page.locator("main")).toContainText("Publishing failed: Connect the school's Facebook Page");

  // 4. Paused: a queued post waits untouched, and Retry is off.
  await connect();
  const queued = await write("Library week", "أسبوع المكتبة", "Library week");
  await admin.from("posts").update({ status: "scheduled", scheduled_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", queued);
  await admin.from("schools").update({ posting_paused_until: new Date(Date.now() + 86400_000).toISOString() }).eq("id", schoolId);
  expect((await cron()).status()).toBe(200);
  expect(await status(queued)).toMatchObject({ status: "scheduled", attempts: 0 });
  await page.goto(`/en/posts/${post}`);
  await expect(page.getByRole("button", { name: "Try publishing again" })).toBeDisabled();

  // 5. Resumed and reconnected: the failed post is scheduled again.
  await admin.from("schools").update({ posting_paused_until: null }).eq("id", schoolId);
  await admin.from("posts").update({ status: "draft", scheduled_at: null }).eq("id", queued);
  await page.reload();
  await when("09:00");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page).toHaveURL(/done=schedule/);
  expect((await status(post)).status).toBe("scheduled");
  await page.screenshot({ path: info.outputPath("scheduled-again.png"), fullPage: true });
  expect(errors).toEqual([]);
});
