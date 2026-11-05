import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { newSchool, watchErrors } from "./helpers";

// Inbox (release 0.6), against a stand-in for Facebook and Instagram
// (e2e/fake-meta.mjs), so nothing reaches the real Meta:
// - comments from the last posts on both show, newest first, questions marked;
// - AI reply ideas only fill the box: nothing is sent until Reply is pressed;
// - a sent reply reaches the Page and the comment moves out of "To answer";
// - a reply Meta refuses says so; hiding a comment hides it on the Page.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const META = "http://127.0.0.1:3998";

test("inbox: comments show, AI ideas never send by themselves, replies and hiding reach the Page", async ({ page, request }) => {
  test.setTimeout(90_000);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, "inbox");
  const errors = watchErrors(page);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await admin.from("memberships").select("school_id").eq("user_id", userId).single();
  const schoolId = m!.school_id as string;

  // Not connected: the page says so.
  await page.goto("/en/inbox");
  await expect(page.locator("main")).toContainText("Connect Facebook and Instagram first");

  // A post published yesterday on both, with comments waiting.
  const stamp = Date.now();
  const fb = `fb${stamp}`;
  const ig = `ig${stamp}`;
  const { error: pe } = await admin.from("posts").insert({ school_id: schoolId, status: "published", caption_ar: "يوم رياضي رائع", caption_en: "A great sports day", fb_post_id: fb, ig_media_id: ig, published_at: new Date(Date.now() - 86400_000).toISOString() });
  expect(pe).toBeNull();
  await admin.from("meta_connections").upsert({ school_id: schoolId, page_id: "123456789", page_name: "Test Page", page_token: "not-a-real-token" });
  const seed = (objectId: string, platform: string, list: object[]) => request.post(`${META}/__seed`, { data: { objectId, platform, list } });
  await seed(fb, "facebook", [
    { text: "What a lovely day, well done to the team!", author: "Mona Said" },
    { text: "متى يبدأ التقديم للعام القادم؟", author: "Ahmed Kamal" },
    { text: "Please remove my photo", author: "Rania Fathy", fail: true },
  ]);
  await seed(ig, "instagram", [{ text: "Amazing 👏", author: "sara.k" }]);
  const sent = async () => ((await (await request.get(`${META}/__calls?prefix=${fb}`)).json()) as { method: string; path: string; params: Record<string, string> }[]).filter((c) => c.method === "POST");

  await page.goto("/en/inbox");
  const main = page.locator("main");
  for (const t of ["What a lovely day", "متى يبدأ التقديم", "Please remove my photo", "Amazing"]) await expect(main).toContainText(t);
  await expect(main).toContainText("To answer 4");
  await expect(main).toContainText("Questions 1");
  await page.screenshot({ path: test.info().outputPath("inbox.png"), fullPage: true });

  // AI ideas for the Arabic question are in Arabic and only fill the box.
  const card = (text: string) => page.locator("li", { hasText: text });
  const question = card("متى يبدأ التقديم");
  await question.getByTitle("Suggest replies").click();
  const idea = question.getByRole("button", { name: /شكراً جزيلاً/ });
  await expect(idea).toBeVisible();
  await idea.click();
  await expect(question.getByPlaceholder("Write a reply…")).toHaveValue(/شكراً جزيلاً/);
  expect(await sent()).toEqual([]);

  // Reply: it reaches the Page and the comment leaves "To answer".
  await question.getByPlaceholder("Write a reply…").fill("التقديم يبدأ في يناير، أهلاً بكم");
  await question.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page).toHaveURL(/sent=1/);
  await expect(main).toContainText("Reply sent.");
  expect(await sent()).toMatchObject([{ path: `${fb}_c1/comments`, params: { message: "التقديم يبدأ في يناير، أهلاً بكم" } }]);
  await expect(main).not.toContainText("متى يبدأ التقديم");
  await expect(main).toContainText("To answer 3");
  const { data: audit } = await admin.from("audit_log").select("action, target").eq("school_id", schoolId).like("action", "inbox.%");
  expect(audit).toEqual([{ action: "inbox.replied", target: `${fb}_c1` }]);

  // Meta refuses a reply: the team is told.
  const refused = card("Please remove my photo");
  await refused.getByPlaceholder("Write a reply…").fill("We'll take care of it today.");
  await refused.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page).toHaveURL(/sent=0/);
  await expect(main).toContainText("Couldn't send the reply.");

  // Hide: hidden on the Page, gone from "To answer", shown as hidden under All.
  await card("Please remove my photo").getByRole("button", { name: "Hide" }).click();
  await expect(main).not.toContainText("Please remove my photo");
  expect((await sent()).at(-1)).toMatchObject({ path: `${fb}_c2`, params: { is_hidden: "true" } });
  await page.goto("/en/inbox?show=all");
  await expect(card("Please remove my photo")).toContainText("hidden");
  await expect(card("متى يبدأ التقديم")).toContainText("replied");

  // A post older than 3 weeks is not read.
  await admin.from("posts").update({ published_at: new Date(Date.now() - 30 * 86400_000).toISOString() }).eq("fb_post_id", fb);
  await page.goto("/en/inbox?show=all");
  await expect(main).toContainText("All answered");
  expect(errors).toEqual([]);
});
