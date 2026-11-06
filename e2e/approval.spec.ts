import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { watchErrors } from "./helpers";

// Release 0.8, items 2 and 3: approval inside the comms team, then the extra
// approver (the principal) for the categories the school picked. Each step
// is done by the right person on the website, and the steps a person may
// not take are refused by the database itself, not only hidden.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });

type Person = { email: string; id: string; db: SupabaseClient };

async function person(schoolId: string, role: string, name: string): Promise<Person> {
  const email = `appr-${role}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const { data: u, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const { error: me } = await admin().from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role, full_name: name });
  if (me) throw me;
  const db = createClient(url, anon, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return { email, id: u.user!.id, db };
}

async function signIn(page: Page, who: Person) {
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(who.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/en\/(today|setup)/);
}

const status = async (id: string) => (await admin().from("posts").select("status, review_note, approved_by, signed_off_by").eq("id", id).single()).data!;

test("comms approval, asking for changes, then the principal's sign-off", async ({ page }) => {
  test.setTimeout(180_000);
  const { data: school } = await admin().from("schools").insert({ name: "Approval school", extra_approval: "categories", approve_by: "lead" }).select("id").single();
  const schoolId = school!.id as string;
  const lead = await person(schoolId, "comms_lead", "Lead Lina");
  const writer = await person(schoolId, "comms", "Writer Omar");
  const principal = await person(schoolId, "principal", "Principal Huda");
  const teacher = await person(schoolId, "teacher", "Teacher Sami");
  // Event posts need the principal too; other categories don't.
  const { data: cats } = await admin().from("categories").select("id, name_en").eq("school_id", schoolId);
  const events = cats!.find((c) => c.name_en === "Events")!.id as string;
  await admin().from("categories").update({ needs_extra_approval: true }).eq("id", events);
  const post = async (category: string | null) =>
    (await admin().from("posts").insert({ school_id: schoolId, created_by: writer.id, category_id: category, status: "draft", platforms: ["facebook"], caption_ar: "يوم رياضي رائع", caption_en: "A great sports day" }).select("id").single()).data!.id as string;
  const sports = await post(events);
  const plain = await post(null);
  const errors = watchErrors(page);

  // 1. The writer sends it for review; they can't approve it themselves.
  await signIn(page, writer);
  await page.goto(`/en/posts/${sports}`);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect.poll(async () => (await status(sports)).status).toBe("in_review");
  const self = await writer.db.from("posts").update({ status: "approved" }).eq("id", sports);
  expect(self.error?.message, "a comms member approving their own post").toMatch(/approval from the comms lead|someone else in comms/);

  // 2. The lead asks for changes, with a reason the writer sees.
  await signIn(page, lead);
  await page.goto(`/en/posts/${sports}`);
  await page.getByPlaceholder("What should change?").fill("Please add the date of the sports day");
  await page.getByRole("button", { name: "Ask for changes" }).click();
  await expect.poll(async () => (await status(sports)).status).toBe("rejected");
  await signIn(page, writer);
  await page.goto(`/en/posts/${sports}`);
  await expect(page.locator("body")).toContainText("Please add the date of the sports day");
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect.poll(async () => (await status(sports)).status).toBe("in_review");

  // 3. The lead approves: an Events post now waits for the principal, and
  //    the lead can't skip that step.
  await signIn(page, lead);
  await page.goto(`/en/posts/${sports}`);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await status(sports)).status).toBe("waiting_extra");
  expect((await status(sports)).approved_by).toBe(lead.id);
  await page.goto(`/en/posts/${sports}`);
  await expect(page.locator("body")).toContainText("Waiting for the extra approver");
  const skip = await lead.db.from("posts").update({ status: "approved" }).eq("id", sports);
  expect(skip.error?.message, "the lead skipping the principal").toMatch(/sign-off from the principal/);

  // 4. The principal signs it off.
  await signIn(page, principal);
  await page.goto(`/en/posts/${sports}`);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await status(sports)).status).toBe("approved");
  expect((await status(sports)).signed_off_by).toBe(principal.id);

  // 5. A post outside the picked categories goes straight to approved.
  await writer.db.from("posts").update({ status: "in_review" }).eq("id", plain);
  await signIn(page, lead);
  await page.goto(`/en/posts/${plain}`);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await status(plain)).status).toBe("approved");
  expect((await status(plain)).signed_off_by).toBeNull();

  // 6. Changing the words of an approved post sends it back for review.
  await writer.db.from("posts").update({ caption_en: "A great sports day with 300 students" }).eq("id", plain);
  expect((await status(plain)).status).toBe("in_review");

  // 7. A teacher can't open posts, approve or change them.
  await signIn(page, teacher);
  await page.goto(`/en/posts/${plain}`);
  await expect(page).not.toHaveURL(new RegExp(plain));
  const t = await teacher.db.from("posts").update({ status: "approved" }).eq("id", plain).select();
  expect(t.data ?? []).toHaveLength(0);
  expect((await status(plain)).status).toBe("in_review");
  expect(errors).toEqual([]);
});
