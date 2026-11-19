import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { watchErrors } from "./helpers";

// 0.13 interface extras from the final plan: the comfort settings (larger
// text, high contrast), swiping between posts waiting for approval, and
// "who's working on this" on a post.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });

async function school() {
  const { data } = await admin().from("schools").insert({ name: `Extras school ${Date.now()}` }).select("id").single();
  return data!.id as string;
}

async function person(schoolId: string, role: string, name: string) {
  const email = `extras-${role}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const { data: u, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await admin().from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role, full_name: name });
  return { email, id: u.user!.id };
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).not.toHaveURL(/\/en\/login/, { timeout: 20_000 });
}

test("comfort settings: larger text and high contrast stay on after reloading", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "runs once");
  const schoolId = await school();
  const lead = await person(schoolId, "comms_lead", "Lead Lina");
  const errors = watchErrors(page);
  await signIn(page, lead.email);
  await page.goto("/en/today");
  const root = page.locator("html");
  await expect(root).not.toHaveAttribute("data-contrast", "high");
  const size = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await page.getByLabel("Easier reading").click();
  await page.getByLabel("Larger text").check();
  await page.getByLabel("High contrast").check();
  await expect(root).toHaveAttribute("data-size", "large");
  await expect(root).toHaveAttribute("data-contrast", "high");
  await page.reload();
  // Applied before the page paints, on every page.
  await expect(root).toHaveAttribute("data-contrast", "high");
  expect(parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize))).toBeGreaterThan(parseFloat(size));
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--muted").trim())).toBe("#2b2f36");
  await page.getByLabel("Easier reading").click();
  await page.getByLabel("High contrast").uncheck();
  await page.reload();
  await expect(root).not.toHaveAttribute("data-contrast", "high");
  expect(errors).toEqual([]);
});

async function waitingPosts(schoolId: string, writer: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { data } = await admin()
      .from("posts")
      .insert({ school_id: schoolId, created_by: writer, status: "draft", platforms: ["facebook"], caption_en: `Waiting post ${i + 1}`, caption_ar: `منشور ${i + 1}` })
      .select("id")
      .single();
    ids.push(data!.id as string);
  }
  for (const id of ids) await admin().from("posts").update({ status: "in_review" }).eq("id", id);
  return ids;
}

async function swipe(page: Page, dx: number) {
  // Wait until the page has started up and listens for swipes.
  await expect(page.locator('[data-testid="swipe-nav"][data-armed]')).toHaveCount(1);
  const box = page.viewportSize()!;
  const y = Math.round(box.height / 2);
  const x = Math.round(box.width / 2);
  await page.evaluate(
    ({ x, y, dx }) => {
      const touch = (cx: number) => new Touch({ identifier: 1, target: document.body, clientX: cx, clientY: y });
      window.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(x)], changedTouches: [touch(x)] }));
      window.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(x + dx)] }));
    },
    { x, y, dx },
  );
}

test("phone approval: swipe between the posts waiting for approval", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone only");
  const schoolId = await school();
  const lead = await person(schoolId, "comms_lead", "Lead Lina");
  const writer = await person(schoolId, "comms", "Writer Omar");
  const [a, b, c] = await waitingPosts(schoolId, writer.id, 3);
  await signIn(page, lead.email);
  await page.goto(`/en/posts/${a}`);
  await expect(page.getByTestId("swipe-nav")).toContainText("1 of 3");
  await swipe(page, -160);
  await expect(page).toHaveURL(new RegExp(`/en/posts/${b}`));
  await swipe(page, -160);
  await expect(page).toHaveURL(new RegExp(`/en/posts/${c}`));
  await expect(page.getByTestId("swipe-nav")).toContainText("3 of 3");
  // A swipe the other way goes back; in Arabic the directions turn round.
  await swipe(page, 160);
  await expect(page).toHaveURL(new RegExp(`/en/posts/${b}`));
  await page.goto(`/ar/posts/${b}`);
  await swipe(page, 160);
  await expect(page).toHaveURL(new RegExp(`/ar/posts/${c}`));
  // A post that is not waiting has no swiping.
  await admin().from("posts").update({ status: "draft" }).eq("id", c);
  await page.goto(`/en/posts/${c}`);
  await expect(page.getByTestId("swipe-nav")).toHaveCount(0);
});

async function open(browser: Browser, email: string, postId: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  await page.goto(`/en/posts/${postId}`);
  return page;
}

test("who's working on this: each person sees the other on the same post", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "runs once");
  test.setTimeout(120_000);
  const schoolId = await school();
  const lead = await person(schoolId, "comms_lead", "Lead Lina");
  const writer = await person(schoolId, "comms", "Writer Omar");
  const [post] = await waitingPosts(schoolId, writer.id, 1);
  const one = await open(browser, lead.email, post);
  await expect(one.getByTestId("post-presence")).toHaveCount(0);
  const two = await open(browser, writer.email, post);
  await expect(two.getByTestId("post-presence")).toContainText("Lead Lina", { timeout: 20_000 });
  await expect(one.getByTestId("post-presence")).toContainText("Writer Omar", { timeout: 20_000 });
  await two.context().close();
  await expect(one.getByTestId("post-presence")).toHaveCount(0, { timeout: 30_000 });
  await one.context().close();
});
