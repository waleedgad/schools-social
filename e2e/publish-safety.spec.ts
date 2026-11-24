import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { newSchool, watchErrors } from "./helpers";

// Release 0.17 (real posting), against the stand-in for Meta (e2e/fake-meta.mjs):
// 1. Meta busy once: the post waits and goes out on a later run, once.
// 2. Facebook or Instagram published but the answer got lost: the retry finds
//    the earlier post and never posts again.
// 3. Facebook signs the school out: Reconnect on Accounts, one alert, nothing
//    more tried; reconnecting (here: Check connection says the key works) clears it.
// 4. Check connection lists what works and what needs a Reconnect.
// 5. Published posts link to Facebook and Instagram; failed ones say why in plain words.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));
test.describe.configure({ mode: "serial" });

const META = "http://127.0.0.1:3998";
type Call = { method: string; path: string; params: Record<string, string> };
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function setup(page: import("@playwright/test").Page, tag: string) {
  const db = admin();
  // Screenshots without the page's fade-in.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const email = await newSchool(page, tag);
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await db.from("memberships").select("school_id").eq("user_id", userId).single();
  const schoolId = m!.school_id as string;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const pageId = `page${stamp}`;
  const igUser = `igu${stamp}`;
  await db.from("meta_connections").upsert({ school_id: schoolId, page_id: pageId, page_name: "Test Page", page_token: "not-a-real-token", ig_user_id: igUser, ig_username: "testschool" });
  // One checked 4:5 photo from the Mac.
  const pathName = `${schoolId}/safety-${stamp}.jpg`;
  const jpg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 40, g: 140, b: 90 } } }).jpeg({ quality: 90 }).toBuffer();
  expect((await db.storage.from("photos").upload(pathName, jpg, { contentType: "image/jpeg" })).error).toBeNull();
  const { data: photo } = await db.from("photos").insert({ school_id: schoolId, source: "desktop", storage_path: pathName, width: 1080, height: 1350 }).select("id").single();
  // A scheduled post, due now, with a caption no other test uses.
  const makePost = async (caption: string, platforms = ["facebook", "instagram"]) => {
    const { data: post, error } = await db
      .from("posts")
      .insert({ school_id: schoolId, status: "scheduled", scheduled_at: new Date(Date.now() - 60_000).toISOString(), caption_ar: `منشور ${caption}`, caption_en: caption, platforms })
      .select("id")
      .single();
    expect(error).toBeNull();
    await db.from("post_photos").insert({ post_id: post!.id, photo_id: photo!.id, school_id: schoolId, position: 0 });
    return post!.id as string;
  };
  return { db, schoolId, pageId, igUser, makePost, stamp };
}

const cron = (request: APIRequestContext) => request.post("/api/cron/publish", { headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {} });
const calls = async (request: APIRequestContext, prefix: string) => ((await (await request.get(`${META}/__calls?prefix=${prefix}`)).json()) as Call[]).filter((c) => c.method === "POST");
const fail = (request: APIRequestContext, rule: object | null) => request.post(`${META}/__fail`, { data: rule ?? "" });
const row = async (id: string) => (await admin().from("posts").select("status, publish_error, publish_reason, retry_at, fb_post_id, ig_media_id, ig_container_id, fb_url, ig_url, attempts").eq("id", id).single()).data!;
// The retry time is minutes away; tests move it to now instead of waiting.
const dueNow = (id: string) => admin().from("posts").update({ retry_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);

test.afterEach(async ({ request }) => {
  await fail(request, null);
  await request.post(`${META}/__token`, { data: "" });
});

test("busy Meta is tried again later, and the post goes out once", async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const s = await setup(page, "busy");
  const id = await s.makePost(`Busy day ${s.stamp}`);
  // Facebook says "request limit reached" once.
  await fail(request, { path: `${s.pageId}/photos`, message: "(#4) Application request limit reached", code: 4, times: 1 });
  expect((await cron(request)).ok()).toBe(true);
  const waiting = await row(id);
  expect(waiting.status).toBe("scheduled");
  expect(waiting.publish_reason).toBe("busy");
  expect(Date.parse(waiting.retry_at!) - Date.now()).toBeGreaterThan(3 * 60_000);
  // Not due yet: the next run leaves it alone.
  await cron(request);
  expect((await row(id)).status).toBe("scheduled");
  // The post page says it will be tried again by itself.
  await page.goto(`/en/posts/${id}`);
  await expect(page.getByText(/was busy\. It will be tried again by itself at/)).toBeVisible();

  await dueNow(id);
  await cron(request);
  const done = await row(id);
  expect(done.status).toBe("published");
  expect(done.attempts).toBe(2);
  expect(done.retry_at).toBeNull();
  const fb = (await calls(request, s.pageId)).filter((c) => c.path === `${s.pageId}/photos`);
  expect(fb).toHaveLength(2); // the refused one and the one that worked
  // Real links: "View on Facebook / Instagram".
  expect(done.fb_url).toMatch(/^https:\/\/www\.facebook\.com\//);
  expect(done.ig_url).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
  await page.goto(`/en/posts/${id}`);
  await expect(page.getByRole("link", { name: "View on Facebook" })).toHaveAttribute("href", done.fb_url!);
  await expect(page.getByRole("link", { name: "View on Instagram" })).toHaveAttribute("href", done.ig_url!);
  expect(errors).toEqual([]);
});

test("a lost answer never makes a second post on Facebook or Instagram", async ({ page, request }) => {
  test.setTimeout(120_000);
  const s = await setup(page, "lost");
  // Facebook: the post is made but the answer is lost.
  const fbOnly = await s.makePost(`Lost answer FB ${s.stamp}`, ["facebook"]);
  await fail(request, { path: `${s.pageId}/photos`, drop: true, times: 1 });
  await cron(request);
  expect((await row(fbOnly)).status).toBe("scheduled");
  await dueNow(fbOnly);
  await cron(request);
  const fbDone = await row(fbOnly);
  expect(fbDone.status).toBe("published");
  const fbPosts = ((await (await request.get(`${META}/${s.pageId}/posts`)).json()) as { data: { id: string; message: string }[] }).data.filter((p) => p.message.includes(`Lost answer FB ${s.stamp}`));
  expect(fbPosts).toHaveLength(1);
  expect(fbDone.fb_post_id).toBe(fbPosts[0].id);

  // Instagram: published, answer lost; the retry finds it by the saved container.
  const igOnly = await s.makePost(`Lost answer IG ${s.stamp}`, ["instagram"]);
  await fail(request, { path: `${s.igUser}/media_publish`, drop: true, times: 1 });
  await cron(request);
  const igWaiting = await row(igOnly);
  expect(igWaiting.status).toBe("scheduled");
  expect(igWaiting.ig_container_id).toMatch(/^container_/);
  await dueNow(igOnly);
  await cron(request);
  const igDone = await row(igOnly);
  expect(igDone.status).toBe("published");
  const media = ((await (await request.get(`${META}/${s.igUser}/media`)).json()) as { data: { id: string; caption: string }[] }).data.filter((m) => m.caption.includes(`Lost answer IG ${s.stamp}`));
  expect(media).toHaveLength(1);
  expect(igDone.ig_media_id).toBe(media[0].id);
  // media_publish was sent once only.
  expect((await calls(request, `${s.igUser}/media_publish`)).length).toBe(1);
});

test("signed out of Facebook: Reconnect, one alert, nothing more tried", async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const s = await setup(page, "reconnect");
  await s.db.from("school_integrations").upsert({ school_id: s.schoolId, email_alerts: true, alert_kinds: ["failed"], quiet_from: null, quiet_to: null });
  const first = await s.makePost(`Signed out one ${s.stamp}`);
  const second = await s.makePost(`Signed out two ${s.stamp}`);
  await fail(request, { path: s.pageId, message: "Error validating access token: The session has been invalidated because the user changed their password.", code: 190, subcode: 460 });
  await cron(request);
  const a = await row(first);
  const b = await row(second);
  expect([a.status, b.status]).toEqual(["failed", "failed"]);
  expect([a.publish_reason, b.publish_reason]).toEqual(["reconnect", "reconnect"]);
  // Only one of the two reached Meta; the other wasn't tried.
  expect((await calls(request, s.pageId)).length).toBe(1);
  const { data: meta } = await s.db.from("meta_connections").select("needs_reconnect").eq("school_id", s.schoolId).single();
  expect(meta!.needs_reconnect).toBe(true);
  // One "Reconnect Facebook" alert for the school, no "post didn't go out" per post.
  const { data: outbox } = await s.db.from("alert_outbox").select("title, emails").eq("school_id", s.schoolId);
  expect(outbox!.map((o) => o.title.split(" · ")[0])).toEqual(["Reconnect Facebook"]);
  expect(outbox![0].emails.length).toBeGreaterThan(0);

  // Accounts shows it in red, and the post says what to do in plain words.
  await page.goto("/en/accounts");
  await expect(page.getByRole("alert").filter({ hasText: "Reconnect Facebook" })).toContainText("Posts waiting for this: 2");
  await expect(page.getByRole("link", { name: "Reconnect Facebook" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("accounts-reconnect-en.png"), fullPage: true });
  await page.goto(`/en/posts/${first}`);
  await expect(page.locator("main")).toContainText("Facebook signed the school out");
  await expect(page.getByRole("link", { name: "Open Accounts" })).toBeVisible();
  await page.goto(`/ar/accounts`);
  await expect(page.getByRole("alert").filter({ hasText: "أعد ربط فيسبوك" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("accounts-reconnect-ar.png"), fullPage: true });

  // Meta takes the key again (the person reconnected); Check connection clears the red.
  await fail(request, null);
  await page.goto("/en/accounts");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("Connection checked")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Reconnect Facebook" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Check connection says what works and what needs a Reconnect", async ({ page, request }) => {
  test.setTimeout(90_000);
  const s = await setup(page, "check");
  // Connected before 0.15: no private-message permissions.
  await request.post(`${META}/__token`, { data: { is_valid: true, scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "pages_manage_engagement", "pages_read_user_content", "instagram_manage_comments", "read_insights", "instagram_manage_insights"] } });
  await page.goto("/en/accounts");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("Connection checked")).toBeVisible();
  const list = page.getByRole("list", { name: "Check connection" });
  await expect(list.getByRole("listitem").filter({ hasText: "Posting to the Facebook Page" })).toContainText("Works");
  await expect(list.getByRole("listitem").filter({ hasText: "Private messages" })).toContainText("Needs Reconnect");
  await page.screenshot({ path: test.info().outputPath("accounts-check-en.png"), fullPage: true });
  await page.goto("/ar/accounts");
  await expect(page.getByRole("list", { name: "فحص الربط" }).getByRole("listitem").filter({ hasText: "الرسائل الخاصة" })).toContainText("يحتاج إعادة ربط");
  await page.screenshot({ path: test.info().outputPath("accounts-check-ar.png"), fullPage: true });

  // The key no longer works at all.
  await request.post(`${META}/__token`, { data: { is_valid: false, scopes: [] } });
  await page.goto("/en/accounts");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("Facebook says the connection no longer works")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Reconnect Facebook" })).toBeVisible();
  const { data: meta } = await s.db.from("meta_connections").select("needs_reconnect").eq("school_id", s.schoolId).single();
  expect(meta!.needs_reconnect).toBe(true);
});

test("a refused photo says why in plain words, with Meta's own words underneath", async ({ page, request }) => {
  test.setTimeout(90_000);
  const s = await setup(page, "refused");
  const id = await s.makePost(`Refused ${s.stamp}`, ["instagram"]);
  await fail(request, { path: `${s.igUser}/media`, message: "(#36003) The aspect ratio is not supported", code: 36003 });
  await cron(request);
  const r = await row(id);
  expect(r.status).toBe("failed");
  expect(r.publish_reason).toBe("photo");
  await page.goto(`/en/posts/${id}`);
  await expect(page.locator("main")).toContainText("refused a photo");
  await expect(page.locator("main")).toContainText("What Meta said: (#36003) The aspect ratio is not supported");
  await page.screenshot({ path: test.info().outputPath("post-failed-en.png"), fullPage: true });
  await page.goto(`/ar/posts/${id}`);
  await expect(page.locator("main")).toContainText("رفض صورة");
  await page.screenshot({ path: test.info().outputPath("post-failed-ar.png"), fullPage: true });
});
