import { _electron, expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Release 0.13: the app's licence. Before signing in, and for a paused
// school, only the sign-in form or the renew notice shows; read-only lets
// the library be looked at but not changed; 10 days without the server is
// read-only too; the library on disk is encrypted with the school's key.
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };
const hub = (win: Page, f: string, ...a: unknown[]) => win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
const plain = (file: string) => readFileSync(file).subarray(0, 16).equals(Buffer.from("SQLite format 3\0"));

async function library() {
  const base = mkdtempSync(path.join(tmpdir(), "hub-lic-"));
  const ev = path.join(base, "Photos", "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  for (let i = 0; i < 2; i++) writeFileSync(path.join(ev, `IMG_${5000 + i}.jpg`), await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90 * i, g: 120, b: 180 } } }).jpeg().toBuffer());
  return path.join(base, "Photos");
}

async function launch(settings: Record<string, unknown>, env: Record<string, string> = {}, userData = mkdtempSync(path.join(tmpdir(), "hub-test-"))) {
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, faces: false, server: "http://127.0.0.1:9", ...settings }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1", HUB_LICENCE: "on", ...env },
  });
  return { app, win: await app.firstWindow(), userData };
}

const testLicence = (over: Record<string, unknown>) =>
  JSON.stringify({
    schoolId: "00000000-0000-0000-0000-000000000001",
    state: "active",
    key: randomBytes(32).toString("base64"),
    checkedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 5 * 86400_000).toISOString(),
    paidUntil: null,
    readOnlyLeft: 0,
    daysLeft: 30,
    forced: false,
    plan: "Standard|قياسية",
    contact: "WhatsApp +20 100 000 0000",
    ...over,
  });

test("not signed in: only the sign-in form; nothing in the library opens", async () => {
  const { app, win } = await launch({ library: await library() });
  await expect(win.getByTestId("licence-gate")).toBeVisible();
  await expect(win.getByText("Sign in to your school")).toBeVisible();
  await expect(win.locator("#side")).toBeHidden();
  expect(await hub(win, "photos", {})).toMatchObject({ ok: false, error: "locked" });
  expect(await hub(win, "importStart", {})).toMatchObject({ ok: false, error: "locked" });
  await win.screenshot({ path: test.info().outputPath("app-sign-in-en.png") });
  await app.close();
});

test("a paused school sees the renew notice in English and Arabic", async () => {
  const lic = testLicence({ state: "blocked", key: null });
  const { app, win } = await launch({ library: await library(), userId: "u", schoolId: "00000000-0000-0000-0000-000000000001", email: "a@example.com" }, { HUB_TEST_LICENCE: lic });
  await expect(win.getByText("Your school's access is paused")).toBeVisible();
  await expect(win.getByText("WhatsApp +20 100 000 0000")).toBeVisible();
  await win.screenshot({ path: test.info().outputPath("app-paused-en.png") });
  await hub(win, "set", "language", "ar");
  await expect(win.getByText("دخول مدرستكم متوقف")).toBeVisible();
  await win.screenshot({ path: test.info().outputPath("app-paused-ar.png") });
  await app.close();
});

test("10 days without the server: read-only, the library can be looked at but not changed", async () => {
  const lib = await library();
  const lic = testLicence({ validUntil: new Date(Date.now() - 3600_000).toISOString() });
  const { app, win, userData } = await launch({ library: lib, userId: "u", schoolId: "00000000-0000-0000-0000-000000000001", email: "a@example.com" }, { HUB_TEST_LICENCE: lic });
  await expect(win.getByTestId("read-only-bar")).toContainText("hasn't reached the school's account for 10 days");
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(2);
  expect(await hub(win, "importStart", {})).toMatchObject({ ok: false, error: "read-only" });
  expect(await hub(win, "newPost", {})).toMatchObject({ ok: false, error: "read-only" });
  // The library on disk is encrypted.
  expect(plain(path.join(userData, "library.db"))).toBe(false);
  await win.screenshot({ path: test.info().outputPath("app-read-only-en.png") });
  await app.close();
});

// Against the test database (the website job in the automatic checks).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

test("signing in brings the school's key: a plain library is encrypted; read-only and paused follow the plan", async () => {
  test.skip(!url || !anon || !service, "needs the test database (source e2e/test-db.env)");
  test.setTimeout(240_000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const email = `mac-lic-${Date.now()}@example.com`;
  const password = "test-password-123";
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const { data: school } = await admin.from("schools").insert({ name: "Licence school" }).select("id").single();
  await admin.from("memberships").insert({ school_id: school!.id, user_id: u.user!.id, role: "admin", full_name: "Mac Tester" });
  const cairoDay = (offset: number) => new Date(Date.now() + 2 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

  // A library made before 0.13 (plain), then the licence switched on.
  const lib = await library();
  const before = await launch({ library: lib, supabaseUrl: url, supabaseAnonKey: anon }, { HUB_LICENCE: "off" });
  await before.win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => before.win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(2);
  await before.app.close();
  const userData = before.userData;
  expect(plain(path.join(userData, "library.db"))).toBe(true);
  const launched = await launch({ library: lib, supabaseUrl: url, supabaseAnonKey: anon }, {}, userData);
  const app = launched.app;
  const win = launched.win;
  await expect(win.getByTestId("licence-gate")).toBeVisible();
  await win.locator("#gem").fill(email);
  await win.locator("#gpw").fill(password);
  await win.locator("#gin").click();
  await expect(win.getByTestId("licence-gate")).toHaveCount(0, { timeout: 30_000 });
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(2);
  expect(plain(path.join(userData, "library.db"))).toBe(false);
  const { data: comps } = await admin.from("computers").select("id").eq("school_id", school!.id);
  expect(comps?.length).toBe(1);

  // Read-only: the bar, and changes refused.
  await admin.from("schools").update({ paid_until: cairoDay(-1) }).eq("id", school!.id);
  await hub(win, "checkLicence");
  await expect(win.getByTestId("read-only-bar")).toContainText("Read-only mode for 13 more days");
  expect(await hub(win, "tagPhotos", [1], "x")).toMatchObject({ ok: false, error: "read-only" });

  // Paused: the key leaves this computer, only the notice shows.
  await admin.from("schools").update({ paid_until: cairoDay(-20) }).eq("id", school!.id);
  await hub(win, "checkLicence");
  await expect(win.getByText("Your school's access is paused")).toBeVisible();
  expect(await hub(win, "photos", {})).toMatchObject({ ok: false, error: "locked" });

  // Paid again: the same library opens with the key it had.
  await admin.from("schools").update({ paid_until: cairoDay(30) }).eq("id", school!.id);
  await win.locator("#gcheck").click();
  await expect(win.getByTestId("licence-gate")).toHaveCount(0, { timeout: 30_000 });
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(2);
  await app.close();
});
