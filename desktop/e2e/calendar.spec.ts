import { _electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Release 0.8, item 5 (Mac): moving a post on the calendar keeps its time of
// day in the school's time zone (Cairo); dropping it on a holiday asks first
// (Cancel leaves it, "Put it here" moves it). B-51: Arabic Hijri dates use
// the same Arabic digits as the rest of the app, never 0-9.
const root = path.join(__dirname, "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const web = process.env.WEB_URL ?? "http://localhost:3123";
test.skip(!url || !anon || !service || !process.env.WEB_URL, "needs the test database and website (WEB_URL)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };
const offset = (k: string) => new Intl.DateTimeFormat("en", { timeZone: "Africa/Cairo", timeZoneName: "longOffset" }).format(new Date(`${k}T12:00:00Z`)).split("GMT")[1] || "+02:00";
const cairo = (k: string) => new Date(`${k}T19:30:00${offset(k)}`).toISOString();

for (const language of ["en", "ar"] as const) {
  test(`Mac calendar: move keeps the time, a holiday asks first (${language})`, async () => {
    test.setTimeout(180_000);
    const admin = createClient(url!, service!, { auth: { persistSession: false } });
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
    const ym = month.toISOString().slice(0, 7);
    const day = (n: number) => `${ym}-${String(n).padStart(2, "0")}`;
    const wd = (k: string) => new Date(`${k}T12:00:00Z`).getUTCDay();
    const open = Array.from({ length: 28 }, (_, i) => day(i + 1)).filter((k) => wd(k) !== 5 && wd(k) !== 6);
    const [from, to, holiday] = [open[2], open[4], open[8]];

    const email = `mcal-${language}-${Date.now()}@example.com`;
    const password = "test-password-123";
    const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const { data: school } = await admin
      .from("schools")
      .insert({ name: "Mac calendar school", timezone: "Africa/Cairo", no_post_days: { weekdays: [5], holidays: true }, holidays: [{ name: "Mid-year break", start: holiday, end: holiday }] })
      .select("id")
      .single();
    const schoolId = school!.id as string;
    await admin.from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role: "comms_lead", full_name: "Lead" });
    const { data: p } = await admin
      .from("posts")
      .insert({ school_id: schoolId, created_by: u.user!.id, status: "draft", platforms: ["facebook"], caption_en: "Science fair photos", caption_ar: "صور معرض العلوم", scheduled_at: cairo(from) })
      .select("id")
      .single();
    const at = async () => new Date((await admin.from("posts").select("scheduled_at").eq("id", p!.id).single()).data!.scheduled_at as string).toISOString();

    const base = mkdtempSync(path.join(tmpdir(), "hub-cal-"));
    mkdirSync(path.join(base, "Photos"), { recursive: true });
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(
      path.join(userData, "settings.json"),
      JSON.stringify({ language, setupDone: true, tourDone: true, wizard: true, library: path.join(base, "Photos"), faces: false, sendMode: "picked", server: web, supabaseUrl: url, supabaseAnonKey: anon }),
    );
    const app = await _electron.launch({
      executablePath: require("electron") as unknown as string,
      args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
      env: { ...process.env, HUB_TEST: "1", TZ: "Africa/Cairo" },
    });
    const win = await app.firstWindow();
    const r = await win.evaluate(([e, pw]) => (window as unknown as Hub).hub.call("signIn", e, pw), [email, password] as const);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await expect.poll(() => win.evaluate("!!(typeof S !== 'undefined' && S && S.signedIn)"), { timeout: 30_000 }).toBeTruthy();

    await win.evaluate((k) => (window as unknown as { go: (v: string, p: object) => void }).go("calendar", { view: "month", day: k }), from);
    const cell = (k: string) => win.locator(`.cday[data-day="${k}"]`);
    const post = win.locator(`.cpost[data-id="${p!.id}"]`);
    await expect(post).toBeVisible({ timeout: 30_000 });

    // B-51: the Hijri day numbers use Arabic digits in Arabic.
    if (language === "ar") {
      const hj = await win.locator(".cday .hj").allTextContents();
      expect(hj.filter((t) => t.trim()).length).toBeGreaterThan(20);
      expect(hj.filter((t) => /[0-9]/.test(t)), "Western digits in Arabic Hijri dates").toEqual([]);
    }

    // 1. Another school day: same time of day, in Cairo.
    await post.dragTo(cell(to));
    await expect.poll(at, { timeout: 20_000 }).toBe(cairo(to));
    await expect(cell(to).locator(`.cpost[data-id="${p!.id}"]`)).toBeVisible();

    // 2. The holiday: it asks. Cancel leaves the post where it was.
    await post.dragTo(cell(holiday));
    const box = win.locator("[data-yes]");
    await expect(box).toBeVisible();
    await expect(win.locator(".modal, [role=dialog]").first()).toContainText("Mid-year break");
    await win.locator("[data-no]").click();
    await win.waitForTimeout(1500);
    expect(await at()).toBe(cairo(to));
    // "Put it here" moves it.
    await post.dragTo(cell(holiday));
    await win.locator("[data-yes]").click();
    await expect.poll(at, { timeout: 20_000 }).toBe(cairo(holiday));
    await win.screenshot({ path: test.info().outputPath(`calendar-${language}.png`) });
    await app.close();
  });
}
