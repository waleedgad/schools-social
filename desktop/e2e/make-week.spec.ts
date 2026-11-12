import { _electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// "Make a week of posts" on the Mac (release 0.6, B-46): the plan comes from
// the website, in the school's time zone, never on a day off or holiday; an
// idea on a day that already has a post starts unticked and says why; only
// ticked ideas are made, as ideas (never scheduled). Needs the test database
// and the test website (the website job on GitHub starts both).
const root = path.join(__dirname, "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const web = process.env.WEB_URL ?? "http://localhost:3123";
test.skip(!url || !anon || !service || !process.env.WEB_URL, "needs the test database and website (WEB_URL)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };
type Idea = { date: string; taken: boolean; title: string };
const DAY = 86400_000;
const cairo = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

test("make a week on the Mac: days off skipped, taken days unticked, only ideas made", async () => {
  test.setTimeout(180_000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const email = `week-${Date.now()}@example.com`;
  const password = "test-password-123";
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const days = Array.from({ length: 10 }, (_, i) => cairo(Date.now() + i * DAY));
  const open = days.filter((d) => ![5, 6].includes(weekday(d)));
  const busy = open[1];
  const { data: school } = await admin.from("schools").insert({ name: "Week school", no_post_days: { weekdays: [5, 6], holidays: true } }).select("id").single();
  const schoolId = school!.id as string;
  await admin.from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role: "admin", full_name: "Comms Lead" });
  expect((await admin.from("posts").insert({ school_id: schoolId, status: "scheduled", caption_en: "Already planned", scheduled_at: `${busy}T15:00:00Z` })).error).toBeNull();

  const base = mkdtempSync(path.join(tmpdir(), "hub-week-"));
  mkdirSync(path.join(base, "Photos"), { recursive: true });
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: path.join(base, "Photos"), faces: false, sendMode: "picked", server: web, supabaseUrl: url, supabaseAnonKey: anon }),
  );
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  const call = async <T = unknown>(f: string, ...a: unknown[]) => {
    const r = await win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
    expect(r.ok, `${f}: ${JSON.stringify(r)}`).toBe(true);
    return r.value as T;
  };
  await call("signIn", email, password);

  // The plan: no days off; the busy day is marked taken.
  const plan = (await call<{ plan: Idea[] }>("app", "planWeek", { days: 7 })).plan;
  expect(plan.length).toBeGreaterThan(0);
  for (const p of plan) expect([5, 6], `${p.date} is a day off`).not.toContain(weekday(p.date));
  const taken = plan.filter((p) => p.taken);
  expect(taken.map((p) => p.date)).toContain(busy);

  // The box: taken days start unticked and say why.
  await expect.poll(() => win.evaluate("!!(typeof S !== 'undefined' && S && S.signedIn)"), { timeout: 30_000 }).toBeTruthy();
  await win.locator('button.nav[data-go="posts"]').click();
  await win.locator("#p-week").click();
  const rows = win.locator(".wkrow");
  await expect(rows).toHaveCount(plan.length, { timeout: 30_000 });
  await expect(win.locator("[data-taken]")).toHaveCount(taken.length);
  for (let i = 0; i < plan.length; i++) await expect(rows.nth(i).locator("input[type=checkbox]")).toBeChecked({ checked: !plan[i].taken });
  await expect(win.locator("[data-taken]").first()).toHaveText("This day already has a post");
  await win.screenshot({ path: test.info().outputPath("make-week.png") });

  // Make them: only the ticked ones, as ideas.
  await win.locator("#wk-go").click();
  await expect
    .poll(async () => (await admin.from("posts").select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("status", "idea")).count, { timeout: 30_000 })
    .toBe(plan.length - taken.length);
  const { data: ideas } = await admin.from("posts").select("due_on, scheduled_at").eq("school_id", schoolId).eq("status", "idea");
  expect(ideas!.map((p) => p.due_on)).not.toContain(busy);
  expect(ideas!.every((p) => p.scheduled_at === null)).toBe(true);
  await app.close();
});
