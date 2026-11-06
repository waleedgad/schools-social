import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { watchErrors } from "./helpers";

// Release 0.8, item 6: "waiting for you" alerts. They go to the people who
// can take the step (never the writer, a teacher, someone who left, or a
// head of stage for another stage), once and never twice, and they wait for
// the end of the school's quiet hours. Email goes to a stand-in (fake-meta).
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });
const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

type Person = { email: string; id: string; db: SupabaseClient };
async function person(schoolId: string, role: string, name: string, extra: Record<string, unknown> = {}): Promise<Person> {
  const email = `alert-${role}-${run}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const { data: u } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  const { error } = await admin().from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role, full_name: name, ...extra });
  if (error) throw error;
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

type Mail = { to: string[]; subject: string; text: string };
// Every email the website sent about this post (its caption is unique).
const mails = async (caption: string) => ((await (await fetch("http://127.0.0.1:3998/__emails")).json()) as Mail[]).filter((m) => m.text.includes(caption));
const cron = async (page: Page) => expect((await page.request.get("/api/cron/publish")).ok()).toBe(true);

test("waiting-for-you alerts: the right people, once, after quiet hours", async ({ page }) => {
  test.setTimeout(180_000);
  const { data: school } = await admin().from("schools").insert({ name: "Alerts school", timezone: "Africa/Cairo", extra_approval: "categories", approve_by: "lead" }).select("id").single();
  const schoolId = school!.id as string;
  // Email alerts on, no quiet hours for the first part.
  await admin().from("school_integrations").upsert({ school_id: schoolId, email_alerts: true, alert_kinds: ["approval", "remind"], quiet_from: null, quiet_to: null });
  const lead = await person(schoolId, "comms_lead", "Lead Lina");
  const writer = await person(schoolId, "comms", "Writer Omar");
  const principal = await person(schoolId, "principal", "Principal Huda");
  const kgHead = await person(schoolId, "principal", "KG head Mona", { stages: ["KG"] });
  const teacher = await person(schoolId, "teacher", "Teacher Sami");
  const left = await person(schoolId, "comms_lead", "Old lead", { active: false });
  // The post is about class 5A (Grade 5), so the KG head can't act on it.
  await admin().from("students").insert([
    { school_id: schoolId, full_name: "Student One", class_name: "5A", stage: "Grade 5", student_code: `a${run}` },
    { school_id: schoolId, full_name: "Student Two", class_name: "KG1A", stage: "KG", student_code: `b${run}` },
  ]);
  const { data: ev } = await admin().from("events").insert({ school_id: schoolId, title: "Science day 5A", event_date: new Date().toISOString().slice(0, 10), class_name: "5A" }).select("id").single();
  const { data: cats } = await admin().from("categories").select("id, name_en").eq("school_id", schoolId);
  const events = cats!.find((c) => c.name_en === "Events")!.id as string;
  await admin().from("categories").update({ needs_extra_approval: true }).eq("id", events);
  const newPost = async (caption: string) =>
    (await admin().from("posts").insert({ school_id: schoolId, created_by: writer.id, category_id: events, event_id: ev!.id, status: "draft", platforms: ["facebook"], caption_en: caption }).select("id").single()).data!.id as string;
  const caption = `Science day ${run}`;
  const id = await newPost(caption);
  const errors = watchErrors(page);

  // 1. The writer sends it for review: only the comms lead hears.
  await signIn(page, writer);
  await page.goto(`/en/posts/${id}`);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect.poll(async () => (await mails(caption)).length, { timeout: 20_000 }).toBe(1);
  expect((await mails(caption))[0].to).toEqual([lead.email]);

  // 2. The lead approves: it waits for the principal. Only the principal for
  //    this stage hears (not the KG head, the lead, the writer or the teacher).
  await signIn(page, lead);
  await page.goto(`/en/posts/${id}`);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await mails(caption)).length, { timeout: 20_000 }).toBe(2);
  const second = (await mails(caption))[1];
  expect(second.subject).toContain("Waiting for your approval");
  expect(second.to).toEqual([principal.email]);

  // 3. A reminder, pressed twice on the same day: one email.
  const token = (await lead.db.auth.getSession()).data.session!.access_token;
  for (let i = 0; i < 2; i++) {
    const r = await page.request.post("/api/app", { headers: { authorization: `Bearer ${token}` }, data: { action: "remind", id, locale: "en", school: schoolId } });
    expect(r.ok()).toBe(true);
  }
  await expect.poll(async () => (await mails(caption)).length, { timeout: 20_000 }).toBe(3);
  await page.waitForTimeout(1500);
  expect(await mails(caption)).toHaveLength(3);
  expect((await mails(caption))[2].to).toEqual([principal.email]);

  // Nobody who can't act, and nobody twice.
  const everyone = (await mails(caption)).flatMap((m) => m.to);
  for (const p of [writer, teacher, left, kgHead]) expect(everyone, p.email).not.toContain(p.email);

  // 4. Quiet hours (school time, around now): the alert waits, then goes
  //    out once when they end, however often the server checks.
  const cairoNow = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const shift = (h: number) => `${String((Number(cairoNow.slice(0, 2)) + h + 24) % 24).padStart(2, "0")}:${cairoNow.slice(3, 5)}`;
  await admin().from("school_integrations").update({ quiet_from: shift(-1), quiet_to: shift(1) }).eq("school_id", schoolId);
  const quietCaption = `Quiet night ${run}`;
  const quiet = await newPost(quietCaption);
  await signIn(page, writer);
  await page.goto(`/en/posts/${quiet}`);
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect.poll(async () => (await admin().from("alert_outbox").select("id").eq("school_id", schoolId).is("sent_at", null)).data?.length ?? 0, { timeout: 20_000 }).toBe(1);
  const { data: held } = await admin().from("alert_outbox").select("id, send_after, emails").eq("school_id", schoolId).is("sent_at", null).single();
  expect(held!.emails).toEqual([lead.email]);
  // It goes out when the quiet hours end (in about an hour).
  const wait = Date.parse(held!.send_after as string) - Date.now();
  expect(wait).toBeGreaterThan(55 * 60_000);
  expect(wait).toBeLessThan(61 * 60_000);
  await cron(page);
  expect(await mails(quietCaption)).toHaveLength(0);
  // The quiet hours end: the next check sends it, once.
  await admin().from("alert_outbox").update({ send_after: new Date(Date.now() - 1000).toISOString() }).eq("id", held!.id);
  await cron(page);
  await cron(page);
  await expect.poll(async () => (await mails(quietCaption)).length).toBe(1);
  expect((await mails(quietCaption))[0].to).toEqual([lead.email]);
  expect(errors).toEqual([]);
});
