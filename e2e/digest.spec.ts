import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { digestDue } from "../src/lib/digest-format";
import { watchErrors } from "./helpers";

// Release 0.8, item 7: the principal's weekly digest. The numbers on the
// page and in the Sunday email match the school's own data, in Arabic and
// English, and the email goes once a week.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });
const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const DAY = 86400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/en\/(today|setup)/);
}

test("Sunday 8 am, school time", () => {
  // 8 Nov 2026 is a Sunday. Cairo is UTC+2 in November.
  expect(digestDue(new Date("2026-11-08T06:00:00Z"), "Africa/Cairo")).toBe("2026-11-08");
  expect(digestDue(new Date("2026-11-08T05:59:00Z"), "Africa/Cairo")).toBeNull();
  expect(digestDue(new Date("2026-11-07T09:00:00Z"), "Africa/Cairo")).toBeNull();
  // Late Saturday in UTC is already Sunday morning in Dubai.
  expect(digestDue(new Date("2026-11-08T04:30:00Z"), "Asia/Dubai")).toBe("2026-11-08");
});

test("the weekly digest matches the school's numbers, page and email", async ({ page }) => {
  test.setTimeout(120_000);
  const { data: school } = await admin().from("schools").insert({ name: `Digest school ${run}`, timezone: "Africa/Cairo" }).select("id").single();
  const schoolId = school!.id as string;
  const email = `digest-${run}@test.local`;
  const { data: u } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  await admin().from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role: "principal", full_name: "Principal Huda" });
  await admin().from("school_integrations").upsert({ school_id: schoolId, email_alerts: true, alert_kinds: ["digest"], quiet_from: null, quiet_to: null });

  // Known data: 3 posted this week (1 older), 1 failed, 2 waiting for the
  // comms lead, 1 for the principal, 2 going out next week (1 later).
  const post = (status: string, extra: Record<string, unknown> = {}) => ({ school_id: schoolId, status, platforms: ["facebook"], caption_en: `Digest ${status}`, ...extra });
  const { error } = await admin().from("posts").insert([
    post("published", { published_at: ago(1) }),
    post("published", { published_at: ago(3) }),
    post("published", { published_at: ago(6) }),
    post("published", { published_at: ago(10) }),
    post("failed"),
    post("in_review"),
    post("in_review"),
    post("waiting_extra"),
    post("scheduled", { scheduled_at: ago(-2) }),
    post("approved", { scheduled_at: ago(-5) }),
    post("scheduled", { scheduled_at: ago(-10) }),
  ]);
  expect(error).toBeNull();
  // 6 students; 2 in 5A and 1 in KG1A are in no photo yet.
  const st = (n: number, cls: string) => ({ school_id: schoolId, full_name: `Student ${n}`, class_name: cls, stage: cls.startsWith("KG") ? "KG" : "Grade 5", student_code: `s${n}${run}` });
  await admin().from("students").insert([st(1, "5A"), st(2, "5A"), st(3, "5A"), st(4, "KG1A"), st(5, "KG1A"), st(6, "5B")]);
  await admin().from("student_coverage").insert([1, 5, 6].map((n) => ({ school_id: schoolId, student_code: `s${n}${run}`, photos: 4 })));
  // One with a photo record but zero photos still counts as not seen.
  await admin().from("student_coverage").insert({ school_id: schoolId, student_code: `s2${run}`, photos: 0 });
  const want = { posted: 3, failed: 1, waitingComms: 2, waitingExtra: 1, scheduled: 2, notSeen: 3 };
  const errors = watchErrors(page);

  await signIn(page, email);
  for (const lang of ["en", "ar"] as const) {
    await page.goto(`/${lang}/digest`);
    for (const [k, n] of Object.entries(want)) await expect(page.locator(`[data-n="${k}"]`), `${lang} ${k}`).toHaveText(n.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB"));
    await expect(page.locator('[data-class="5A"]')).toContainText(lang === "ar" ? "٢" : "2");
    await expect(page.locator('[data-class="KG1A"]')).toContainText(lang === "ar" ? "١" : "1");
    await expect(page.locator('[data-class="5B"]')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`digest-${lang}.png`), fullPage: true });
  }

  // The email: the same numbers, both languages, once a week.
  const mails = async () => ((await (await fetch("http://127.0.0.1:3998/__emails")).json()) as { to: string[]; subject: string; text: string }[]).filter((m) => m.subject.includes(`Digest school ${run}`));
  expect((await page.request.get("/api/cron/publish")).ok()).toBe(true);
  expect((await page.request.get("/api/cron/publish")).ok()).toBe(true);
  await expect.poll(async () => (await mails()).length).toBe(1);
  await page.waitForTimeout(1000);
  const [m] = await mails();
  expect(await mails()).toHaveLength(1);
  expect(m.to).toEqual([email]);
  for (const line of ["Posted: 3", "Didn't go out: 1", "Waiting for the comms team: 2", "Waiting for your approval: 1", "Scheduled for next week: 2", "Students not in any photo yet: 3 of 6", "5A: 2", "KG1A: 1"]) expect(m.text).toContain(line);
  for (const line of ["نُشر: ٣", "بانتظار فريق التواصل: ٢", "طلاب لم يظهروا في أي صورة بعد: ٣ من ٦"]) expect(m.text).toContain(line);
  expect(errors).toEqual([]);
});
