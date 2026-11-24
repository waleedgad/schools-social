import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Release 0.13: the owner page, plans and the Active / Read-only / Blocked
// states, the way Waleed and a school would use them.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });
const cairoDay = (offset: number) => new Date(Date.now() + 2 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

async function person(tag: string) {
  const email = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { email, id: data.user!.id };
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).not.toHaveURL(/\/en\/login/, { timeout: 20_000 });
}

test("the owner makes a school; the school sees its plan, read-only and paused, and a payment brings it back", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const owner = await person("owner");
  await admin().from("owners").insert({ user_id: owner.id });
  const schoolAdmin = await person("admin");
  const name = `Plan school ${Date.now()}`;

  // 1. The owner page: a new school on Small with a trial and the Admin's invite.
  await signIn(page, owner.email);
  await expect(page).toHaveURL(/\/en\/owner/);
  await page.getByRole("link", { name: "New school" }).click();
  await page.getByLabel("School name").fill(name);
  await page.getByLabel("Plan").selectOption("small");
  await page.getByLabel("Admin's email").fill(schoolAdmin.email);
  await page.getByRole("button", { name: "Create school" }).click();
  await expect(page.getByText("School created.")).toBeVisible();
  const link = (await page.getByTestId("admin-invite-link").textContent())!.trim();
  expect(link).toContain("/invite/");
  await page.screenshot({ path: test.info().outputPath("owner-school-en.png"), fullPage: true });

  // 2. The Admin joins from the invite and sees the plan.
  const school = await browser.newContext();
  const sp = await school.newPage();
  await signIn(sp, schoolAdmin.email);
  await sp.goto(new URL(link).pathname);
  await sp.getByLabel("Full name").fill("Test Admin");
  await sp.getByRole("button", { name: "Join the school" }).click();
  await expect(sp).toHaveURL(/\/en\/(today|setup)/);
  // A trial ending in 14 days: the yellow bar for the Admin.
  await expect(sp.getByTestId("plan-bar")).toContainText("trial ends in 14 days");
  await sp.goto("/en/plan");
  await expect(sp.getByTestId("plan-name")).toContainText("Small");
  await expect(sp.getByText("1 of 2")).toBeVisible();
  await expect(sp.getByText("WhatsApp +20 100 000 0000")).toBeVisible();
  await sp.screenshot({ path: test.info().outputPath("school-plan-en.png"), fullPage: true });

  // 3. A plan full of managing users: the third invite is refused with the plan's words.
  const { data: row } = await admin().from("schools").select("id").eq("name", name).single();
  const schoolId = row!.id as string;
  await sp.goto("/en/staff");
  await sp.getByLabel("Email").first().fill(`comms1-${Date.now()}@test.local`);
  await sp.getByLabel("Role").first().selectOption("comms");
  await sp.getByRole("button", { name: "Create invite link" }).click();
  await expect(sp.getByText("Managing users: 1 of 2")).toBeVisible();
  await sp.getByLabel("Email").first().fill(`comms2-${Date.now()}@test.local`);
  await sp.getByLabel("Role").first().selectOption("comms");
  await sp.getByRole("button", { name: "Create invite link" }).click();
  await expect(sp.getByText("Your plan allows 2 managing users.")).toBeVisible();
  // Teachers are free.
  await sp.getByLabel("Email").first().fill(`teacher-${Date.now()}@test.local`);
  await sp.getByLabel("Role").first().selectOption("teacher");
  await sp.getByRole("button", { name: "Create invite link" }).click();
  await expect(sp.getByText("Your plan allows 2 managing users.")).toHaveCount(0);

  // 4. Read-only: the bar for everyone, buttons greyed out, no new post.
  await admin().from("schools").update({ paid_until: cairoDay(-1) }).eq("id", schoolId);
  await sp.goto("/en/today");
  await expect(sp.getByTestId("plan-bar")).toContainText("read-only mode for 13 more days");
  await expect(sp.getByRole("link", { name: "Create post" })).toHaveCount(0);
  await sp.goto("/en/staff");
  await expect(sp.getByRole("button", { name: "Create invite link" })).toBeDisabled();
  await sp.screenshot({ path: test.info().outputPath("school-read-only-en.png"), fullPage: true });
  // The database refuses the change even if the button were pressed.
  const { data: session } = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }).auth.signInWithPassword({ email: schoolAdmin.email, password });
  const asAdmin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } }, auth: { persistSession: false } });
  const refused = await asAdmin.from("posts").insert({ school_id: schoolId, created_by: schoolAdmin.id });
  expect(refused.error?.message).toContain("school-read-only");

  // 5. Paused: only the renew notice and Sign out.
  await admin().from("schools").update({ paid_until: cairoDay(-20) }).eq("id", schoolId);
  await sp.goto("/en/posts");
  await expect(sp.getByTestId("blocked")).toBeVisible();
  await expect(sp.getByText("Your school's access is paused")).toBeVisible();
  await expect(sp.getByRole("button")).toHaveCount(1);
  await sp.screenshot({ path: test.info().outputPath("school-blocked-en.png"), fullPage: true });
  await sp.goto("/ar/posts");
  await expect(sp.getByText("دخول مدرستكم متوقف")).toBeVisible();
  await sp.screenshot({ path: test.info().outputPath("school-blocked-ar.png"), fullPage: true });

  // 6. The owner sees it paused and records a payment: active again at once.
  await page.goto("/en/owner?f=blocked");
  await expect(page.getByTestId("owner-schools")).toContainText(name);
  await page.getByRole("link", { name }).click();
  await page.getByLabel("Amount").fill("12000");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByTestId("owner-school-state")).toContainText("Active");
  await page.goto("/en/owner/log");
  await expect(page.getByTestId("owner-log")).toContainText("Payment recorded");
  await page.goto("/ar/owner");
  await page.screenshot({ path: test.info().outputPath("owner-schools-ar.png"), fullPage: true });
  await sp.goto("/en/posts");
  await expect(sp.getByTestId("blocked")).toHaveCount(0);
  await expect(sp.getByTestId("plan-bar")).toHaveCount(0);
  await school.close();
});

test("a school admin cannot open the owner page or call the owner functions", async ({ page }) => {
  const a = await person("not-owner");
  const { data: s } = await admin().from("schools").insert({ name: "Not owner school" }).select("id").single();
  await admin().from("memberships").insert({ school_id: s!.id, user_id: a.id, role: "admin", full_name: "Admin" });
  await signIn(page, a.email);
  await page.goto("/en/owner");
  await expect(page).not.toHaveURL(/\/en\/owner/);
  const { data: session } = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }).auth.signInWithPassword({ email: a.email, password });
  const asAdmin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } }, auth: { persistSession: false } });
  const list = await asAdmin.rpc("owner_schools");
  expect(list.error?.message).toContain("not-owner");
  const force = await asAdmin.rpc("owner_force_state", { p_school: s!.id, p_state: "active", p_reason: "x" });
  expect(force.error?.message).toContain("not-owner");
  const keys = await asAdmin.from("school_keys").select("*");
  expect(keys.data ?? []).toEqual([]);
});

// S-21N-01: the "admins update their school" rule had no column limits, so a
// school admin could give their school a bigger plan, a later paid-until date
// or lift a forced block straight through the database. Migration 0021.
test("a school admin cannot change their own plan, dates or state; ordinary settings still save", async () => {
  const a = await person("plan-cheat");
  const { data: s } = await admin().from("schools").insert({ name: "Plan cheat school" }).select("id, plan_id, paid_until, extra_managers").single();
  await admin().from("memberships").insert({ school_id: s!.id, user_id: a.id, role: "admin", full_name: "Admin" });
  const { data: session } = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }).auth.signInWithPassword({ email: a.email, password });
  const asAdmin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } }, auth: { persistSession: false } });
  const tries: Record<string, unknown>[] = [
    { plan_id: "large" }, { plan_managers: 99 }, { plan_computers: 9 }, { extra_managers: 50 }, { extra_computers: 9 },
    { paid_until: "2099-01-01" }, { trial: false }, { forced_state: "active" }, { forced_reason: "x" }, { read_only_days: 60 },
  ];
  for (const change of tries) {
    const r = await asAdmin.from("schools").update(change).eq("id", s!.id).select("id");
    expect(r.error?.message, JSON.stringify(change)).toContain("owner-only");
  }
  const { data: after } = await admin().from("schools").select("plan_id, paid_until, extra_managers").eq("id", s!.id).single();
  expect(after).toEqual({ plan_id: s!.plan_id, paid_until: s!.paid_until, extra_managers: s!.extra_managers });
  // The school's own settings still save, and the server key still changes dates.
  const ok = await asAdmin.from("schools").update({ self_filing: true }).eq("id", s!.id).select("id");
  expect(ok.error).toBeNull();
  expect(ok.data).toHaveLength(1);
  const server = await admin().from("schools").update({ paid_until: "2030-01-01" }).eq("id", s!.id);
  expect(server.error).toBeNull();
});

// S-21N-02: a school's time zone set to a name the database doesn't know
// used to break the read-only/blocked check for every school, so the
// publishing job posted for paused schools. Migration 0022.
test("a made-up time zone is refused and the school states still read", async () => {
  const a = await person("tz-cheat");
  const { data: s } = await admin().from("schools").insert({ name: "Time zone school" }).select("id").single();
  await admin().from("memberships").insert({ school_id: s!.id, user_id: a.id, role: "admin", full_name: "Admin" });
  const { data: session } = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }).auth.signInWithPassword({ email: a.email, password });
  const asAdmin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } }, auth: { persistSession: false } });
  const bad = await asAdmin.from("schools").update({ timezone: "Not/AZone" }).eq("id", s!.id).select("id");
  expect(bad.error?.message).toContain("bad-timezone");
  const badServer = await admin().from("schools").update({ timezone: "Not/AZone" }).eq("id", s!.id);
  expect(badServer.error?.message).toContain("bad-timezone");
  const good = await asAdmin.from("schools").update({ timezone: "Asia/Dubai" }).eq("id", s!.id).select("id");
  expect(good.error).toBeNull();
  const states = await admin().rpc("all_school_states");
  expect(states.error).toBeNull();
  expect((states.data as { id: string; state: string }[]).find((x) => x.id === s!.id)?.state).toBe("active");
});
