import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { watchErrors } from "./helpers";

// Release 0.8, item 4: approve from a phone. The comms lead makes an approval
// link for someone without an account; it opens on a phone without signing
// in, shows the post, and can be answered once. An old, used or made-up link
// says so clearly. The principal can also approve on a phone-size screen.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "phone screen only"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });

async function person(schoolId: string, role: string, name: string) {
  const email = `link-${role}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const { data: u } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  await admin().from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role, full_name: name });
  return { email, id: u.user!.id };
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/en\/(today|setup)/);
}

for (const lang of ["en", "ar"] as const) {
  test(`approval link on a phone, answered once (${lang})`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const { data: school } = await admin().from("schools").insert({ name: "Link school" }).select("id").single();
    const schoolId = school!.id as string;
    const lead = await person(schoolId, "comms_lead", "Lead Lina");
    const { data: p } = await admin()
      .from("posts")
      .insert({ school_id: schoolId, created_by: lead.id, status: "in_review", platforms: ["facebook"], caption_ar: "حفل التخرج يوم الخميس", caption_en: "Graduation on Thursday" })
      .select("id")
      .single();
    const postId = p!.id as string;

    // The lead makes a link for the school owner.
    await signIn(page, lead.email);
    await page.goto(`/en/posts/${postId}`);
    await page.getByRole("button", { name: "Comments" }).click();
    await page.getByPlaceholder("Who is it for?").fill("Mr Karim (owner)");
    await page.getByRole("button", { name: "Make link" }).click();
    await expect.poll(async () => (await admin().from("review_links").select("token").eq("post_id", postId)).data?.length ?? 0).toBe(1);
    const token = (await admin().from("review_links").select("token").eq("post_id", postId).single()).data!.token as string;

    // The owner opens it on a phone, not signed in.
    await page.context().clearCookies();
    const errors = watchErrors(page);
    await page.goto(`/${lang}/review/${token}`);
    await expect(page.locator("body")).toContainText("حفل التخرج يوم الخميس");
    await expect(page.locator("body")).toContainText("Graduation on Thursday");
    await expect(page.locator("body")).toContainText("Link school");
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide, "nothing wider than the phone").toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`review-link-${lang}.png`), fullPage: true });
    await page.locator('textarea[name="comment"]').fill("Lovely, go ahead");
    await page.getByRole("button", { name: lang === "en" ? "Approve" : "اعتماد", exact: true }).click();
    await expect(page).toHaveURL(/answered=approved/);

    // The team sees the answer on the post.
    const { data: comments } = await admin().from("post_comments").select("body, author_name").eq("post_id", postId);
    expect(comments!.map((c) => `${c.author_name}: ${c.body}`)).toContain("Mr Karim (owner): Approved by link: Lovely, go ahead");

    // Opening it again: already answered, no buttons.
    await page.goto(`/${lang}/review/${token}`);
    await expect(page.locator('textarea[name="comment"]')).toHaveCount(0);
    await expect(page.locator("main, body").first()).toContainText(lang === "en" ? "already been answered" : "تم الرد على هذا الرابط");
    // An expired link and a made-up one.
    const { data: l2 } = await admin().from("review_links").insert({ post_id: postId, school_id: schoolId, label: "Old link", created_by: lead.id, expires_at: new Date(Date.now() - 86400_000).toISOString() }).select("token").single();
    await page.goto(`/${lang}/review/${l2!.token}`);
    await expect(page.locator('textarea[name="comment"]')).toHaveCount(0);
    await page.goto(`/${lang}/review/not-a-real-link-123`);
    await expect(page.locator('textarea[name="comment"]')).toHaveCount(0);
    if (lang === "en") await expect(page.locator("body")).toContainText("This link doesn't work.");
    expect(errors).toEqual([]);
  });
}

test("the principal approves on a phone", async ({ page }) => {
  test.setTimeout(120_000);
  const { data: school } = await admin().from("schools").insert({ name: "Phone school", extra_approval: "all" }).select("id").single();
  const schoolId = school!.id as string;
  const lead = await person(schoolId, "comms_lead", "Lead Lina");
  const principal = await person(schoolId, "principal", "Principal Huda");
  const { data: p } = await admin().from("posts").insert({ school_id: schoolId, created_by: lead.id, status: "draft", platforms: ["facebook"], caption_ar: "رحلة إلى المتحف", caption_en: "Trip to the museum" }).select("id").single();
  // The lead approves it (as the lead), which sends it to the principal.
  const lc = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await lc.auth.signInWithPassword({ email: lead.email, password });
  const { error } = await lc.from("posts").update({ status: "approved" }).eq("id", p!.id);
  expect(error).toBeNull();
  expect((await admin().from("posts").select("status").eq("id", p!.id).single()).data!.status).toBe("waiting_extra");

  await signIn(page, principal.email);
  await page.goto("/en/today");
  // Today shows what waits for the principal, one tap away.
  await expect(page.locator("body")).toContainText(/Trip to the museum|رحلة إلى المتحف/);
  await page.goto(`/en/posts/${p!.id}`);
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.scrollIntoViewIfNeeded();
  await expect(approve).toBeInViewport();
  await approve.click();
  await expect.poll(async () => (await admin().from("posts").select("status").eq("id", p!.id).single()).data!.status).toBe("approved");
});
