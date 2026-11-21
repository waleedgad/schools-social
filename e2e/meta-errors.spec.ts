import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { newSchool, watchErrors } from "./helpers";

// When Meta says no (L-24): an expired page key, Meta's request limit and
// Meta being down, against the stand-in for Meta (e2e/fake-meta.mjs). In each
// case the post is failed with a reason the school can read, nothing is
// posted twice, and once Meta works again the post goes out.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const META = "http://127.0.0.1:3998";
type Call = { method: string; path: string; params: Record<string, string> };

async function setUp(page: Page, tag: string) {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, tag);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await admin.from("memberships").select("school_id").eq("user_id", userId).single();
  const schoolId = m!.school_id as string;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const pageId = `page${stamp}`;
  const igUser = `igu${stamp}`;
  await admin.from("meta_connections").upsert({ school_id: schoolId, page_id: pageId, page_name: "Test Page", page_token: "not-a-real-token", ig_user_id: igUser, ig_username: "testschool" });
  const pathName = `${schoolId}/meta-errors-${stamp}.jpg`;
  const jpg = await sharp({ create: { width: 1440, height: 1800, channels: 3, background: { r: 60, g: 160, b: 90 } } }).jpeg({ quality: 90 }).toBuffer();
  expect((await admin.storage.from("photos").upload(pathName, jpg, { contentType: "image/jpeg" })).error).toBeNull();
  const { data: photo } = await admin.from("photos").insert({ school_id: schoolId, source: "desktop", storage_path: pathName, width: 1440, height: 1800 }).select("id").single();
  return { admin, schoolId, pageId, igUser, photoId: photo!.id as string };
}

// Writes and approves a post with the photo, through the website.
async function approvedPost(page: Page, admin: SupabaseClient, schoolId: string, photoId: string, about: string) {
  await page.goto("/en/posts/new");
  await page.getByLabel(/what is it about/i).fill(about);
  await page.getByRole("button", { name: /start writing/i }).click();
  await expect(page).toHaveURL(/\/en\/posts\/[0-9a-f-]+/);
  const id = page.url().split("/").pop()!.split("?")[0];
  await admin.from("post_photos").insert({ post_id: id, photo_id: photoId, school_id: schoolId, position: 0 });
  await admin.from("posts").update({ platforms: ["facebook", "instagram"] }).eq("id", id);
  await page.reload();
  await page.getByLabel("Caption in Arabic").fill(`${about} بالعربي`);
  await page.getByLabel("Caption in English").fill(about);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  return id;
}

const posted = async (request: APIRequestContext, prefix: string) =>
  ((await (await request.get(`${META}/__calls?prefix=${prefix}`)).json()) as Call[]).filter((c) => c.method === "POST" && !c.path.endsWith("/comments"));
const state = async (admin: SupabaseClient, id: string) =>
  (await admin.from("posts").select("status, publish_error, fb_post_id, ig_media_id, attempts").eq("id", id).single()).data!;

test("an expired page key fails the post with Meta's reason; after reconnecting it goes out once", async ({ page, request }) => {
  test.setTimeout(150_000);
  const { admin, schoolId, pageId, igUser, photoId } = await setUp(page, "meta-expired");
  const errors = watchErrors(page);
  const id = await approvedPost(page, admin, schoolId, photoId, "Science fair");

  // Meta's answer when the person who connected the Page changed their password.
  await request.post(`${META}/__fail`, {
    data: { path: pageId, code: 190, subcode: 460, message: "Error validating access token: The session has been invalidated because the user changed their password." },
  });
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect.poll(async () => (await state(admin, id)).status, { timeout: 60_000 }).toBe("failed");
  const failed = await state(admin, id);
  expect(failed.publish_error).toContain("Error validating access token");
  expect(failed.fb_post_id).toBeNull();
  // Facebook goes first, so Instagram was never tried with the bad key.
  expect(failed.ig_media_id).toBeNull();
  expect(await posted(request, igUser)).toHaveLength(0);
  const { data: conn } = await admin.from("meta_connections").select("last_error").eq("school_id", schoolId).single();
  expect(conn!.last_error).toContain("Error validating access token");
  await page.reload();
  await expect(page.locator("main")).toContainText("Error validating access token");
  // The connections page shows the problem too.
  await page.goto("/en/accounts");
  await expect(page.locator("main")).toContainText("Error validating access token");

  // The school connects the Page again (a new key), then tries again.
  await request.post(`${META}/__fail`, { data: { path: pageId, clear: true } });
  await admin.from("meta_connections").update({ page_token: "a-new-key" }).eq("school_id", schoolId);
  await page.goto(`/en/posts/${id}`);
  await page.getByRole("button", { name: "Try publishing again" }).click();
  await expect.poll(async () => (await state(admin, id)).status, { timeout: 60_000 }).toBe("published");
  const done = await state(admin, id);
  expect(done.fb_post_id).toMatch(/^fbpost_/);
  expect(done.ig_media_id).toMatch(/^igmedia_/);
  // One photo goes out as one Page photo post: the refused call, then the one that worked.
  expect((await posted(request, pageId)).map((c) => c.path)).toEqual([`${pageId}/photos`, `${pageId}/photos`]);
  const { data: after } = await admin.from("meta_connections").select("last_error").eq("school_id", schoolId).single();
  expect(after!.last_error).toBeNull();
  expect(errors).toEqual([]);
});

test("Meta's request limit and Meta being down: the scheduled post fails, waits for a person, and Facebook never gets it twice", async ({ page, request }) => {
  test.setTimeout(150_000);
  const { admin, schoolId, pageId, igUser, photoId } = await setUp(page, "meta-limit");
  const errors = watchErrors(page);
  const id = await approvedPost(page, admin, schoolId, photoId, "Sports day");
  const cron = () => request.get("/api/cron/publish");

  // Due now (as if scheduled earlier); Instagram answers "too many calls" once.
  await request.post(`${META}/__fail`, { data: { path: `${igUser}/media`, code: 4, message: "(#4) Application request limit reached", times: 1 } });
  await admin.from("posts").update({ status: "scheduled", scheduled_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", id);
  await expect.poll(async () => (expect((await cron()).status()).toBe(200), (await state(admin, id)).status), { timeout: 60_000 }).toBe("failed");
  const limited = await state(admin, id);
  expect(limited.publish_error).toContain("request limit reached");
  expect(limited.fb_post_id).toMatch(/^fbpost_/);
  expect(limited.ig_media_id).toBeNull();
  expect(limited.attempts).toBe(1);

  // Today a failed post is not tried again by the scheduler on its own
  // (see later.md: automatic retry for Meta's temporary errors).
  expect((await cron()).status()).toBe(200);
  expect((await state(admin, id)).attempts).toBe(1);

  // Meta is down (an error page, not JSON): the retry fails with a plain reason.
  await request.post(`${META}/__fail`, { data: { path: `${igUser}/media`, status: 503 } });
  await page.goto(`/en/posts/${id}`);
  await page.getByRole("button", { name: "Try publishing again" }).click();
  await expect.poll(async () => (await state(admin, id)).attempts, { timeout: 60_000 }).toBe(2);
  await expect.poll(async () => (await state(admin, id)).status, { timeout: 60_000 }).toBe("failed");
  expect((await state(admin, id)).publish_error).toContain("Meta request failed (503)");

  // Meta is back: only Instagram gets it; Facebook still has exactly one post.
  await request.post(`${META}/__fail`, { data: { path: `${igUser}/media`, clear: true } });
  await page.reload();
  await page.getByRole("button", { name: "Try publishing again" }).click();
  await expect.poll(async () => (await state(admin, id)).status, { timeout: 60_000 }).toBe("published");
  const done = await state(admin, id);
  expect(done.fb_post_id).toBe(limited.fb_post_id);
  expect(done.ig_media_id).toMatch(/^igmedia_/);
  expect((await posted(request, pageId)).map((c) => c.path)).toEqual([`${pageId}/photos`]);
  expect(errors).toEqual([]);
});
