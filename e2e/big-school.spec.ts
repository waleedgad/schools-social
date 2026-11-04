import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { newSchool, watchErrors } from "./helpers";

// A school after a few years on the website: 120 events, 12,000 photos and
// 3,000 posts (each with photos, some with comments). Every page must still
// open quickly and without errors. The photos are rows only (no files), so
// pictures show as empty boxes; what is measured is the database and the page.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const EVENTS = 120;
const PHOTOS = 12_000;
const POSTS = 3_000;
const PAGES = [
  "today", "library", "posts", "calendar", "inbox", "coverage", "students", "albums", "books",
  "shots", "categories", "analytics", "activity", "check", "upload", "posts/new", "settings",
];
// Most of a school's posts are long posted; one in ten is still in progress.
const OPEN = ["idea", "draft", "in_review", "approved", "scheduled", "rejected"];

async function inBatches<T>(rows: T[], size: number, send: (b: T[]) => PromiseLike<{ error: unknown }>) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await send(rows.slice(i, i + size));
    if (error) throw new Error(JSON.stringify(error));
  }
}

test("a big school's website stays quick", async ({ page, browserName }, info) => {
  test.skip(info.project.name !== "desktop" || browserName !== "chromium", "desktop only");
  test.setTimeout(600_000);
  const email = await newSchool(page, "big");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const me = users.users.find((u) => u.email === email)!;
  const { data: mem } = await db.from("memberships").select("school_id").eq("user_id", me.id).single();
  const school = mem!.school_id as string;

  const now = Date.now();
  const day = 86_400_000;
  const { data: events, error: ee } = await db
    .from("events")
    .insert(Array.from({ length: EVENTS }, (_, e) => ({ school_id: school, title: `Event ${e}`, event_date: new Date(now - (EVENTS - e) * 6 * day).toISOString().slice(0, 10), created_by: me.id })))
    .select("id");
  if (ee) throw new Error(ee.message);
  const photos = Array.from({ length: PHOTOS }, (_, i) => ({
    id: crypto.randomUUID(),
    school_id: school,
    event_id: events![i % EVENTS].id,
    uploaded_by: me.id,
    source: "desktop",
    storage_path: `${school}/big/${i}.jpg`,
    width: 1600,
    height: 1200,
    original_name: `IMG_${i}.jpg`,
    taken_at: new Date(now - (PHOTOS - i) * 3_600_000).toISOString(),
    ai_score: (i % 10) + 1,
  }));
  await inBatches(photos, 1000, (b) => db.from("photos").insert(b));
  // Nothing waits for the Mac's face check, as on a school's real website.
  await db.from("photos").update({ check_status: "ready" }).eq("school_id", school);
  const posts = Array.from({ length: POSTS }, (_, i) => {
    const status = i % 10 === 0 ? OPEN[(i / 10) % OPEN.length] : "published";
    const at = new Date(now + (i - POSTS * 0.8) * 8 * 3_600_000).toISOString();
    return {
      id: crypto.randomUUID(),
      school_id: school,
      event_id: events![i % EVENTS].id,
      status,
      caption_en: `Post ${i}: a day at school`,
      caption_ar: `منشور ${i}`,
      created_by: me.id,
      scheduled_at: ["scheduled", "approved", "published"].includes(status) ? at : null,
      published_at: status === "published" ? at : null,
    };
  });
  await inBatches(posts, 1000, (b) => db.from("posts").insert(b));
  const links = posts.flatMap((p, i) => [0, 1, 2].map((k) => ({ post_id: p.id, photo_id: photos[(i * 3 + k) % PHOTOS].id, school_id: school, position: k })));
  await inBatches(links, 2000, (b) => db.from("post_photos").insert(b));
  const comments = posts.filter((_, i) => i % 5 === 0).map((p) => ({ post_id: p.id, school_id: school, user_id: me.id, body: "Looks good" }));
  await inBatches(comments, 1000, (b) => db.from("post_comments").insert(b));

  const times: Record<string, number> = {};
  const problems: string[] = [];
  for (const p of PAGES) {
    const errors = watchErrors(page);
    // Twice: the first visit also warms up the server, the second is what a
    // school feels day to day.
    await page.goto(`/en/${p}`);
    const t0 = Date.now();
    const res = await page.goto(`/en/${p}`, { waitUntil: "load" });
    times[p] = Date.now() - t0;
    if ((res?.status() ?? 0) >= 400) problems.push(`${p}: HTTP ${res?.status()}`);
    const text = await page.locator("body").innerText();
    if (/Application error|Internal Server Error|This page could not be found/i.test(text)) problems.push(`${p}: error page`);
    // Broken image files are expected (rows only); anything else is a problem.
    const real = errors.filter((e) => !/Failed to load resource|400 \(Bad Request\)|404/.test(e));
    if (real.length) problems.push(`${p}: ${real[0].slice(0, 160)}`);
  }
  console.log("big-school", JSON.stringify({ photos: PHOTOS, posts: POSTS, times }));
  expect(problems).toEqual([]);
  for (const [p, ms] of Object.entries(times)) expect(ms, `${p} took ${ms} ms`).toBeLessThan(3000);
  // The board shows every post in progress and last month's posted ones,
  // not just the latest few hundred (B-33).
  const inProgress = posts.filter((p) => p.status !== "published").length;
  await page.goto("/en/posts");
  await expect(page.getByText(/منشور \d+/).first()).toBeVisible();
  const recent = posts.filter((p) => p.status === "published" && Date.parse(p.published_at!) > Date.now() - 30 * day).length;
  const shown = await page.locator("a[href*='/posts/']:not([href$='/new'])").count();
  expect(shown).toBeGreaterThanOrEqual(inProgress + recent);
});
