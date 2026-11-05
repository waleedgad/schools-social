import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { newSchool, watchErrors } from "./helpers";

// Publish now, all the way to Facebook and Instagram (release 0.6), against a
// stand-in for Meta (e2e/fake-meta.mjs) that downloads every photo link the
// way Meta does. Two photos go out as a Facebook post and an Instagram
// carousel, with the first comment and the story. When Instagram refuses,
// the post is failed with Meta's reason and a retry posts only to Instagram,
// so Facebook never gets it twice.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const META = "http://127.0.0.1:3998";
type Call = { method: string; path: string; params: Record<string, string> };

test("publish now reaches Facebook and Instagram, and a retry never posts twice", async ({ page, request }) => {
  test.setTimeout(120_000);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, "meta");
  const errors = watchErrors(page);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await admin.from("memberships").select("school_id").eq("user_id", userId).single();
  const schoolId = m!.school_id as string;
  const stamp = Date.now();
  const pageId = `page${stamp}`;
  const igUser = `igu${stamp}`;
  await admin.from("meta_connections").upsert({ school_id: schoolId, page_id: pageId, page_name: "Test Page", page_token: "not-a-real-token", ig_user_id: igUser, ig_username: "testschool" });
  const calls = async (prefix: string) => ((await (await request.get(`${META}/__calls?prefix=${prefix}`)).json()) as Call[]).filter((c) => c.method === "POST");
  const post = async (id: string) => (await admin.from("posts").select("status, publish_error, fb_post_id, ig_media_id, attempts").eq("id", id).single()).data!;

  // Two photos from the Mac, already checked.
  const photoIds: string[] = [];
  for (const [i, colour] of [[0, { r: 200, g: 60, b: 60 }], [1, { r: 60, g: 60, b: 200 }]] as const) {
    const pathName = `${schoolId}/meta-test-${stamp}-${i}.jpg`;
    const jpg = await sharp({ create: { width: 1440, height: 1800, channels: 3, background: colour } }).jpeg({ quality: 90 }).toBuffer();
    expect((await admin.storage.from("photos").upload(pathName, jpg, { contentType: "image/jpeg" })).error).toBeNull();
    const { data, error } = await admin.from("photos").insert({ school_id: schoolId, source: "desktop", storage_path: pathName, width: 1440, height: 1800 }).select("id").single();
    expect(error).toBeNull();
    photoIds.push(data!.id as string);
  }

  const write = async (about: string, ar: string, en: string, extra: Record<string, unknown>) => {
    await page.goto("/en/posts/new");
    await page.getByLabel(/what is it about/i).fill(about);
    await page.getByRole("button", { name: /start writing/i }).click();
    await expect(page).toHaveURL(/\/en\/posts\/[0-9a-f-]+/);
    const id = page.url().split("/").pop()!.split("?")[0];
    await admin.from("post_photos").insert(photoIds.map((photo_id, position) => ({ post_id: id, photo_id, school_id: schoolId, position })));
    await admin.from("posts").update(extra).eq("id", id);
    await page.reload();
    await page.getByLabel("Caption in Arabic").fill(ar);
    await page.getByLabel("Caption in English").fill(en);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
    return id;
  };

  // 1. Publish now: Facebook post with two photos, Instagram carousel, first comment, story.
  const first = await write("Sports day", "يوم رياضي رائع", "A great sports day", { first_comment: "#sportsday #school", make_story: true, platforms: ["facebook", "instagram"] });
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect.poll(async () => (await post(first)).status, { timeout: 60_000 }).toBe("published");
  const done = await post(first);
  expect(done.fb_post_id).toMatch(/^fbpost_/);
  expect(done.ig_media_id).toMatch(/^igmedia_/);
  const fb = await calls(pageId);
  expect(fb.map((c) => c.path)).toEqual([`${pageId}/photos`, `${pageId}/photos`, `${pageId}/feed`]);
  expect(fb.slice(0, 2).every((c) => c.params.published === "false")).toBe(true);
  expect(fb[2].params.message).toContain("يوم رياضي رائع");
  expect(fb[2].params.message).toContain("A great sports day");
  expect(JSON.parse(fb[2].params.attached_media)).toHaveLength(2);
  const ig = await calls(igUser);
  // Two carousel items, the carousel, publish; then the story and its publish.
  expect(ig.map((c) => c.path)).toEqual([`${igUser}/media`, `${igUser}/media`, `${igUser}/media`, `${igUser}/media_publish`, `${igUser}/media`, `${igUser}/media_publish`]);
  expect(ig[2].params).toMatchObject({ media_type: "CAROUSEL" });
  expect(ig[2].params.children.split(",")).toHaveLength(2);
  expect(ig[4].params).toMatchObject({ media_type: "STORIES" });
  // The first comment on both.
  expect((await calls(done.fb_post_id!)).map((c) => c.params.message)).toEqual(["#sportsday #school"]);
  expect((await calls(done.ig_media_id!)).map((c) => c.params.message)).toEqual(["#sportsday #school"]);
  const { data: audit } = await admin.from("audit_log").select("action").eq("school_id", schoolId).eq("action", "post.published");
  expect(audit).toHaveLength(1);

  // 2. Instagram refuses: failed with Meta's reason; Facebook already went out.
  const second = await write("Book week", "أسبوع الكتاب", "Book week", { platforms: ["facebook", "instagram"] });
  const fbBefore = (await calls(pageId)).length;
  await request.post(`${META}/__fail`, { data: { path: `${igUser}/media`, message: "(#36003) The aspect ratio is not supported" } });
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect.poll(async () => (await post(second)).status, { timeout: 60_000 }).toBe("failed");
  const failed = await post(second);
  expect(failed.publish_error).toContain("aspect ratio is not supported");
  expect(failed.fb_post_id).toMatch(/^fbpost_/);
  expect(failed.ig_media_id).toBeNull();
  await page.reload();
  await expect(page.locator("main")).toContainText("aspect ratio is not supported");

  // 3. Fixed on Meta's side, retry: only Instagram gets it.
  await request.post(`${META}/__fail`, { data: "" });
  const fbAfterFail = (await calls(pageId)).length;
  expect(fbAfterFail - fbBefore).toBe(3);
  await page.getByRole("button", { name: "Try publishing again" }).click();
  await expect.poll(async () => (await post(second)).status, { timeout: 60_000 }).toBe("published");
  const retried = await post(second);
  expect(retried.fb_post_id).toBe(failed.fb_post_id);
  expect(retried.ig_media_id).toMatch(/^igmedia_/);
  expect(retried.attempts).toBe(2);
  expect((await calls(pageId)).length).toBe(fbAfterFail);
  await page.screenshot({ path: test.info().outputPath("published.png"), fullPage: true });
  expect(errors).toEqual([]);
});
