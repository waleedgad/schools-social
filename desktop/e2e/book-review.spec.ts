import { _electron, chromium, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Yearbook review (release 0.6): the Mac sends a class book to the website;
// the class teacher checks the names of the class on the website, corrects a
// spelling, comments on a page and writes the class message; the Mac sees all
// of it and puts the corrected spelling into the class list. Needs the test
// database and the test website (the website job on GitHub starts both).
const root = path.join(__dirname, "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const web = process.env.WEB_URL ?? "http://localhost:3123";
test.skip(!url || !anon || !service || !process.env.WEB_URL, "needs the test database and website (WEB_URL)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };
type Review = { sent: boolean; status: string | null; version: number | null; checks: { student_code: string; ok: boolean; fixed_name: string | null }[]; comments: { page: number; body: string }[]; texts: { kind: string; body: string; class_name: string | null }[] };

test("a class book goes to the website, the teacher checks it, the Mac sees the answers", async () => {
  test.setTimeout(240_000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const stamp = Date.now();
  const password = "test-password-123";
  const user = async (email: string) => (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id;
  const leadEmail = `lead-${stamp}@example.com`;
  const teacherEmail = `teacher-${stamp}@example.com`;
  const lead = await user(leadEmail);
  const teacher = await user(teacherEmail);
  const { data: school } = await admin.from("schools").insert({ name: "Book review school" }).select("id").single();
  const schoolId = school!.id as string;
  const { error: me } = await admin.from("memberships").insert([
    { school_id: schoolId, user_id: lead, role: "admin", full_name: "Comms Lead", classes: [] },
    { school_id: schoolId, user_id: teacher, role: "teacher", full_name: "Ms Salma", classes: ["G6B"] },
  ]);
  expect(me).toBeNull();
  await admin.from("students").insert([
    { school_id: schoolId, student_code: "R1", full_name: "Omar Hassan", name_ar: "عمر حسن", class_name: "G6B", active: true },
    { school_id: schoolId, student_code: "R2", full_name: "Laila Mostafa", name_ar: "ليلى مصطفى", class_name: "G6B", active: true },
  ]);

  // The Mac library: one event with the class in it.
  const base = mkdtempSync(path.join(tmpdir(), "hub-review-"));
  const ev = path.join(base, "Photos", "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  for (let i = 0; i < 3; i++) writeFileSync(path.join(ev, `IMG_${7000 + i}.jpg`), await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: 40 + i * 60, g: 120, b: 200 } } }).jpeg().toBuffer());
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
  await call("signIn", leadEmail, password);
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(3);
  await expect
    .poll(() => win.evaluate("Promise.all(lib.list.map((p) => window.hub.call('photo', p.id))).then((r) => r.filter((x) => (x.value ?? x)?.thumb === 1).length)"), { timeout: 60_000 })
    .toBe(3);
  await call("addStudent", { id: "R1", name_en: "Omar Hassan", name_ar: "عمر حسن", class_name: "G6B", grade: "Grade 6" });
  await call("addStudent", { id: "R2", name_en: "Laila Mostafa", name_ar: "ليلى مصطفى", class_name: "G6B", grade: "Grade 6" });
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  db.exec("pragma busy_timeout = 5000");
  const ids = (db.prepare("select id from photos order by path").all() as { id: number }[]).map((r) => r.id);
  const face = db.prepare("insert into faces (photo_id, x, y, w, h, score, status, student_id) values (?, ?, 0.3, 0.2, 0.27, 0.99, 'confirmed', ?)");
  for (const id of ids) face.run(id, 0.1, "R1"), face.run(id, 0.6, "R2");
  db.close();

  // The Mac makes the class book and sends it.
  const bookId = await call<number>("newBook", { kind: "class", year: "2025-2026", className: "G6B" });
  const sent = await call<{ pages: number; version: number }>("bookSend", bookId);
  expect(sent.pages).toBeGreaterThan(2);
  const { data: rows } = await admin.from("books").select("id, title, pages, version, status").eq("school_id", schoolId);
  expect(rows).toHaveLength(1);
  const webBook = rows![0];
  expect(webBook.title).toBe("Class G6B");
  expect((webBook.pages as unknown[]).length).toBe(sent.pages);
  // Every page picture is in storage.
  const first = (webBook.pages as { image: string; students: string[]; type: string }[])[0];
  expect((await admin.storage.from("photos").download(first.image)).data?.size ?? 0).toBeGreaterThan(5_000);
  const classPage = (webBook.pages as { students: string[]; type: string }[]).find((p) => p.type === "class")!;
  expect([...classPage.students].sort()).toEqual(["R1", "R2"]);
  // Nobody hears back before the teacher answers.
  expect((await call<Review>("bookReview", bookId)).checks).toEqual([]);

  // The class teacher on the website.
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.goto(`${web}/en/login`);
  await page.getByLabel("Email").first().fill(teacherEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).not.toHaveURL(/login/, { timeout: 30_000 });
  await page.goto(`${web}/en/books`);
  await expect(page.locator("main")).toContainText("Class G6B");
  // The first page shows as a picture.
  await page.goto(`${web}/en/books/${webBook.id}`);
  const pic = page.locator("main img").first();
  await expect(pic).toBeVisible();
  await expect.poll(() => pic.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // A comment on page 1.
  await page.getByLabel("Add a comment").fill("Please use the team photo on the cover");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("main")).toContainText("Please use the team photo on the cover");
  // Names: Omar is right, Laila's English spelling is fixed.
  await page.goto(`${web}/en/books/${webBook.id}?tab=names`);
  await expect(page.locator("main")).toContainText("Omar Hassan");
  await page.locator('input[name="fix.R2"]').fill("Laila Moustafa");
  await page.screenshot({ path: test.info().outputPath("book-names.png") });
  await page.getByRole("button", { name: "Save the names" }).click();
  await expect(page).toHaveURL(/saved=names/);
  // The class message.
  await page.goto(`${web}/en/books/${webBook.id}?tab=texts`);
  await page.locator('textarea[name="body"]').fill("Dear G6B, what a year! Ms Salma");
  await page.getByRole("button", { name: "Add the text" }).click();
  await expect(page).toHaveURL(/saved=text/);
  await expect(page.locator("main")).toContainText("Dear G6B, what a year!");
  await browser.close();

  // The Mac sees everything.
  const review = await call<Review>("bookReview", bookId);
  expect(review.sent).toBe(true);
  expect(review.version).toBe(sent.version);
  const byCode = Object.fromEntries(review.checks.map((c) => [c.student_code, c]));
  expect(byCode.R1).toMatchObject({ ok: true, fixed_name: null });
  expect(byCode.R2).toMatchObject({ ok: false, fixed_name: "Laila Moustafa" });
  expect(review.comments).toMatchObject([{ page: 1, body: "Please use the team photo on the cover" }]);
  expect(review.texts).toMatchObject([{ kind: "teacher", class_name: "G6B", body: "Dear G6B, what a year! Ms Salma" }]);
  // The corrected spelling goes into the Mac's class list and the book.
  await call("bookFixName", "R2", "Laila Moustafa");
  expect(await call<string>("bookHtml", bookId)).toContain("Laila Moustafa");

  // A second version replaces the first on the website; the checks stay.
  const again = await call<{ version: number }>("bookSend", bookId);
  expect(again.version).toBeGreaterThan(sent.version);
  const { data: after } = await admin.from("books").select("id, version").eq("school_id", schoolId);
  expect(after).toEqual([{ id: webBook.id, version: again.version }]);
  expect((await call<Review>("bookReview", bookId)).checks).toHaveLength(2);
  await app.close();
});
