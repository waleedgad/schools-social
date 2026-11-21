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

  // B-119: a changed comment id can't aim the Page key at another address
  // (here: posting straight to the Page's feed, skipping approval).
  const lovely = card("What a lovely day");
  // Typing first: the page redraws the form while typing, which would put the real id back.
  await lovely.getByPlaceholder("Write a reply…").fill("Posted without approval");
  await lovely.locator('input[name="comment"]').evaluateAll((els) => els.forEach((el) => ((el as HTMLInputElement).value = "123456789/feed?x=")));
  await lovely.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page).toHaveURL(/sent=0/);
  const toPage = ((await (await request.get(`${META}/__calls?prefix=123456789`)).json()) as { method: string }[]).filter((c) => c.method === "POST");
  expect(toPage).toEqual([]);

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

// Release 0.15: private messages (Messenger and Instagram) in the inbox, and
// saved replies the team taps instead of typing.
test("inbox: saved replies and private messages", async ({ page, request }) => {
  test.setTimeout(90_000);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, "inbox-messages");
  const errors = watchErrors(page);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await admin.from("memberships").select("school_id").eq("user_id", userId).single();
  const schoolId = m!.school_id as string;
  const pageId = `9${Date.now()}`;
  const igId = `17${Date.now()}`;
  await admin.from("meta_connections").upsert({ school_id: schoolId, page_id: pageId, page_name: "Test Page", page_token: "not-a-real-token", ig_user_id: igId });
  const seed = (platform: string, list: object[]) => request.post(`${META}/__seedConvos`, { data: { pageId, platform, list } });
  await seed("messenger", [
    { withId: "5551", withName: "Hany Samir", text: "كم مصروفات KG1؟" },
    { withId: "5552", withName: "Dina Adel", text: "Thanks for the photos!", fromPage: true },
  ]);
  await seed("instagram", [{ withId: "7771", withName: "mariam.z", text: "Is the open day on Saturday?" }]);

  // A saved reply.
  await page.goto("/en/inbox");
  const savedBox = page.getByTestId("saved-replies");
  await savedBox.locator("summary").click();
  await savedBox.getByLabel("Name").fill("Fees");
  await savedBox.getByLabel("Reply").fill("Please send us a private message and we'll share the fees.");
  await savedBox.getByRole("button", { name: "Save the reply" }).click();
  await expect(page.getByTestId("saved-replies")).toContainText("Saved replies (1)");
  const { data: snip } = await admin.from("snippets").select("kind, title").eq("school_id", schoolId);
  expect(snip).toEqual([{ kind: "reply", title: "Fees" }]);

  // Messages: the two waiting ones show, the answered one only under All.
  await page.goto("/en/inbox?view=messages");
  const main = page.locator("main");
  await expect(main).toContainText("كم مصروفات KG1؟");
  await expect(main).toContainText("Is the open day on Saturday?");
  await expect(main).not.toContainText("Thanks for the photos!");
  await expect(main).toContainText("To answer 2");
  await page.screenshot({ path: test.info().outputPath("inbox-messages.png"), fullPage: true });

  // The saved reply fills the box; sending answers the person privately.
  const card = page.locator("li", { hasText: "كم مصروفات" });
  await card.getByRole("button", { name: "Fees" }).click();
  await expect(card.getByPlaceholder("Write a reply…")).toHaveValue("Please send us a private message and we'll share the fees.");
  await card.getByPlaceholder("Write a reply…").fill("مصروفات KG1 في الملف المرفق على صفحتنا، أهلاً بكم");
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page).toHaveURL(/view=messages/);
  await expect(page).toHaveURL(/sent=1/);
  const posts = ((await (await request.get(`${META}/__calls?prefix=${pageId}/messages`)).json()) as { method: string; params: Record<string, string> }[]).filter((c) => c.method === "POST");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0].params.recipient)).toEqual({ id: "5551" });
  expect(JSON.parse(posts[0].params.message)).toEqual({ text: "مصروفات KG1 في الملف المرفق على صفحتنا، أهلاً بكم" });
  expect(posts[0].params.messaging_type).toBe("RESPONSE");
  await expect(main).not.toContainText("كم مصروفات KG1؟");
  await expect(main).toContainText("To answer 1");

  // A changed recipient can't aim the Page key at another address.
  const ig = page.locator("li", { hasText: "open day" });
  await ig.getByPlaceholder("Write a reply…").fill("Yes, from 10 am");
  await ig.locator('input[name="comment"]').evaluateAll((els) => els.forEach((el) => ((el as HTMLInputElement).value = "123/feed")));
  await ig.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page).toHaveURL(/sent=0/);
  const after = ((await (await request.get(`${META}/__calls?prefix=${pageId}/messages`)).json()) as { method: string }[]).filter((c) => c.method === "POST");
  expect(after).toHaveLength(1);

  // Removing the saved reply.
  await page.goto("/en/inbox");
  await page.getByTestId("saved-replies").locator("summary").click();
  await page.getByTestId("saved-replies").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("saved-replies")).toContainText("Saved replies (0)");
  expect(errors).toEqual([]);
});
