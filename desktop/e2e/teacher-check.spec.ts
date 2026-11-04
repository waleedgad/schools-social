import { _electron, chromium, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// B-03 (0.5 checklist #3): the class teacher confirms a face from a photo
// that is NOT on the website. The Mac sends two small pictures, the teacher
// answers "Is this …?" on the website, the Mac names the face, and the
// pictures are deleted. Needs the test database and the test website
// (the website job on GitHub starts both).
const root = path.join(__dirname, "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const web = process.env.WEB_URL ?? "http://localhost:3123";
test.skip(!url || !anon || !service || !process.env.WEB_URL, "needs the test database and website (WEB_URL)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };

test("a teacher confirms a face from a photo that isn't on the website", async () => {
  test.setTimeout(240_000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const stamp = Date.now();
  const password = "test-password-123";
  const user = async (email: string) => (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id;
  const leadEmail = `lead-${stamp}@example.com`;
  const teacherEmail = `teacher-${stamp}@example.com`;
  const lead = await user(leadEmail);
  const teacher = await user(teacherEmail);
  const { data: school } = await admin.from("schools").insert({ name: "Face check school" }).select("id").single();
  const schoolId = school!.id as string;
  const { error: me } = await admin.from("memberships").insert([
    { school_id: schoolId, user_id: lead, role: "admin", full_name: "Comms Lead", classes: [] },
    { school_id: schoolId, user_id: teacher, role: "teacher", full_name: "Ms Salma", classes: ["G3A"] },
  ]);
  expect(me).toBeNull();
  await admin.from("students").insert({ school_id: schoolId, student_code: "S100", full_name: "Youssef Adel", name_ar: "يوسف عادل", class_name: "G3A", active: true });

  // A Mac library with one photo that stays on the Mac (nothing is picked).
  const base = mkdtempSync(path.join(tmpdir(), "hub-check-"));
  const ev = path.join(base, "Photos", "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  const img = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 90, g: 140, b: 200 } } })
    .composite([{ input: Buffer.from('<svg width="1200" height="900"><circle cx="600" cy="300" r="120" fill="#e0b090"/></svg>'), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
  writeFileSync(path.join(ev, "IMG_8000.jpg"), img);
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
  const call = (f: string, ...a: unknown[]) => win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
  const signed = await call("signIn", leadEmail, password);
  expect(signed.ok, JSON.stringify(signed)).toBe(true);
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(1);
  const photoId = (await win.evaluate("lib.list[0].id")) as number;
  await expect.poll(async () => (((await call("photo", photoId)).value ?? {}) as { thumb?: number }).thumb, { timeout: 60_000 }).toBe(1);

  // The Mac thinks the face is Youssef, but isn't sure.
  expect((await call("addStudent", { id: "S100", name_en: "Youssef Adel", name_ar: "يوسف عادل", class_name: "G3A" })).ok).toBe(true);
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  db.exec("pragma busy_timeout = 5000");
  const faceId = Number(db.prepare("insert into faces (photo_id, x, y, w, h, score, status, suggest_id, suggest_score) values (?, 0.4, 0.2, 0.2, 0.27, 0.95, 'suggested', 'S100', 0.8)").run(photoId).lastInsertRowid);
  db.close();

  // Ask the class teacher. The photo is not on the website.
  expect((await admin.from("photos").select("id").eq("school_id", schoolId)).data).toEqual([]);
  const sent = (await call("sendFaceChecks", "G3A")).value as { sent: number };
  expect(sent.sent).toBe(1);
  const { data: checks } = await admin.from("face_checks").select("id, photo_id, crop_path, context_path, class_name").eq("school_id", schoolId);
  expect(checks).toHaveLength(1);
  expect(checks![0].photo_id).toBeNull();
  expect(checks![0].crop_path).toMatch(new RegExp(`^${schoolId}/checks/`));
  const files = async () => ((await admin.storage.from("photos").list(`${schoolId}/checks`)).data ?? []).map((f) => f.name);
  expect(await files()).toHaveLength(2);
  // Nobody can open the pictures directly, not even the teacher: only through the website.
  const asTeacher = createClient(url!, anon!, { auth: { persistSession: false } });
  await asTeacher.auth.signInWithPassword({ email: teacherEmail, password });
  const direct = await asTeacher.storage.from("photos").download(checks![0].crop_path as string);
  expect(direct.data).toBeNull();

  // The teacher answers on the website.
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.goto(`${web}/en/login`);
  await page.getByLabel("Email").first().fill(teacherEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).not.toHaveURL(/login/, { timeout: 30_000 });
  await page.goto(`${web}/en/check`);
  await expect(page.locator("body")).toContainText("Youssef Adel");
  // Both small pictures show.
  const pics = page.locator("main img");
  await expect(pics).toHaveCount(2);
  for (const el of await pics.all()) await expect(el).toHaveJSProperty("complete", true);
  expect(await pics.first().evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath("teacher-check.png") });
  await page.getByRole("button", { name: "Yes" }).click();
  await expect(page.locator("body")).not.toContainText("Youssef Adel", { timeout: 15_000 });
  await browser.close();
  // Answered: the pictures are deleted straight away.
  await expect.poll(files, { timeout: 15_000 }).toEqual([]);

  // The Mac collects the answer and names the face.
  expect(((await call("pullFaceChecks")).value as { yes: number }).yes).toBe(1);
  await expect
    .poll(async () => {
      const d = new DatabaseSync(path.join(userData, "library.db"));
      const r = d.prepare("select status, student_id from faces where id = ?").get(faceId) as { status: string; student_id: string | null };
      d.close();
      return r;
    }, { timeout: 30_000 })
    .toEqual({ status: "confirmed", student_id: "S100" });
  await expect.poll(async () => (await admin.from("face_checks").select("id").eq("school_id", schoolId)).data?.length, { timeout: 15_000 }).toBe(0);
  await app.close();
});
