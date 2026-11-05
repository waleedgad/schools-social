import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { newSchool, watchErrors } from "./helpers";

// B-47: the website draws pages on a server in world time (UTC), and the
// browser takes over in its own time zone. A time written straight into a
// page came out different on the two sides, and the page broke as it loaded
// for everyone not on UTC, which includes every school in Cairo. Every page
// with times on it opens cleanly with the browser in Cairo time, and times
// show in Cairo time.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));
test.use({ timezoneId: "Africa/Cairo" });

test("pages with times open cleanly in Cairo time", async ({ page }) => {
  test.setTimeout(240_000);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, "tz");
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const schoolId = (await admin.from("memberships").select("school_id").eq("user_id", userId).single()).data!.school_id as string;
  // 21:30 UTC is 23:30 in Cairo (00:30 the next day in summer time).
  const day = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const at = `${day}T21:30:00Z`;
  const soon = new Date(Date.now() + 2 * 86400_000).toISOString();
  expect(
    (
      await admin.from("posts").insert([
        { school_id: schoolId, status: "published", caption_en: "Published one", published_at: at, scheduled_at: at },
        { school_id: schoolId, status: "scheduled", caption_en: "Scheduled one", scheduled_at: soon },
        { school_id: schoolId, status: "failed", caption_en: "Failed one", publish_error: "Test", scheduled_at: at },
        { school_id: schoolId, status: "idea", idea: "An idea", due_on: soon.slice(0, 10) },
        { school_id: schoolId, status: "in_review", caption_en: "Waiting one" },
      ])
    ).error,
  ).toBeNull();
  const { data: posts } = await admin.from("posts").select("id").eq("school_id", schoolId);
  const cairo = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" }).format(new Date(at));

  const pages = ["today", "posts", "posts?view=list", "posts?view=grid", "calendar", "activity", "analytics", "reports", ...posts!.map((p) => `posts/${p.id}`)];
  const problems: string[] = [];
  for (const locale of ["en", "ar"])
    for (const p of pages) {
      const errors = watchErrors(page);
      await page.goto(`/${locale}/${p}`);
      await page.waitForLoadState("networkidle").catch(() => null);
      if (errors.length) problems.push(`${locale}/${p}: ${errors.map((e) => e.slice(0, 120)).join(" | ")}`);
    }
  expect(problems).toEqual([]);
  // The board shows the published time in Cairo time.
  await page.goto("/en/posts");
  await expect(page.locator("main")).toContainText(cairo);
});
