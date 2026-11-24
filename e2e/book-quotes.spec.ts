import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { watchErrors } from "./helpers";

// B-138 (found 24 Nov 2026, fixed in 0.16): a student quote written on the
// website had no way to say which student it was for, so the Mac's "Put
// them all in the book" never placed it under a name. Now the form has a
// student picker (a teacher sees only their own classes), and the quote
// lands under that student on the Mac's class page.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });
const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function person(schoolId: string, role: string, name: string, classes: string[] = []) {
  const email = `quote-${role}-${run}@test.local`;
  const { data: u, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const { error: me } = await admin().from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role, full_name: name, classes });
  if (me) throw me;
  return email;
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/en\/(today|setup)/);
}

const words = {
  en: { kind: "What is it?", quote: "Student's quote", student: "For student (student quotes only)", body: "Text", add: "Add the text" },
  ar: { kind: "ما هو؟", quote: "اقتباس طالب", student: "للطالب (أقوال الطلاب فقط)", body: "النص", add: "أضف النص" },
};

test("a student quote from the website lands under that student's name in the book", async ({ page }, info) => {
  test.setTimeout(120_000);
  const { data: school } = await admin().from("schools").insert({ name: `Quote school ${run}`, timezone: "Africa/Cairo" }).select("id").single();
  const schoolId = school!.id as string;
  const omar = `om${run}`.slice(0, 40);
  const sara = `sa${run}`.slice(0, 40);
  await admin().from("students").insert([
    { school_id: schoolId, full_name: "Omar Hassan", name_ar: "عمر حسن", class_name: "4A", stage: "Grade 4", student_code: omar },
    { school_id: schoolId, full_name: "Sara Ali", name_ar: "سارة علي", class_name: "5B", stage: "Grade 5", student_code: sara },
  ]);
  const pages = [
    { n: 1, title: "4A", image: "", students: [omar], type: "class" },
    { n: 2, title: "5B", image: "", students: [sara], type: "class" },
  ];
  const { data: book } = await admin().from("books").insert({ school_id: schoolId, mac_id: `mac-${run}`, title: "Yearbook 2026", kind: "grade", pages }).select("id").single();
  const bookId = book!.id as string;
  const teacher = await person(schoolId, "teacher", "Ms Mona", ["4A"]);
  const lead = await person(schoolId, "comms_lead", "Lead Laila");
  const errors = watchErrors(page);

  // The class teacher of 4A sees only 4A's students and writes Omar's quote.
  await signIn(page, teacher);
  const w = words.en;
  await page.goto(`/en/books/${bookId}?tab=texts`);
  await page.getByLabel(w.kind).selectOption({ label: w.quote });
  const picker = page.getByLabel(w.student);
  await expect(picker.locator("option", { hasText: "Omar Hassan" })).toHaveCount(1);
  await expect(picker.locator("option", { hasText: "Sara Ali" })).toHaveCount(0);
  await picker.selectOption({ label: "Omar Hassan" });
  await page.getByLabel(w.body, { exact: true }).fill("I will miss our science lab.");
  await page.getByRole("button", { name: w.add }).click();
  await expect(page).toHaveURL(/saved=text/);
  await expect(page.locator("li", { hasText: "I will miss our science lab." }).getByText("Omar Hassan")).toBeVisible();
  await page.screenshot({ path: info.outputPath("book-quote-en.png"), fullPage: true, caret: "initial" });

  // A student from another class can't be slipped in by editing the form.
  await page.getByLabel(w.kind).selectOption({ label: w.quote });
  await picker.evaluate((el, code) => {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = "forged";
    el.appendChild(o);
    (el as HTMLSelectElement).value = code;
  }, sara);
  await page.getByLabel(w.body, { exact: true }).fill("Not my class");
  await page.getByRole("button", { name: w.add }).click();
  await expect(page).toHaveURL(/saved=noStudent/);

  // The comms lead, in Arabic, sees every class and writes Sara's quote.
  await signIn(page, lead);
  const a = words.ar;
  await page.goto(`/ar/books/${bookId}?tab=texts`);
  await page.getByLabel(a.kind).selectOption({ label: a.quote });
  await page.getByLabel(a.student).selectOption({ label: "سارة علي" });
  await page.getByLabel(a.body, { exact: true }).fill("سأشتاق إلى أصدقائي");
  await page.getByRole("button", { name: a.add }).click();
  await expect(page).toHaveURL(/saved=text/);
  await expect(page.locator("li", { hasText: "سأشتاق إلى أصدقائي" }).getByText("سارة علي")).toBeVisible();
  await page.screenshot({ path: info.outputPath("book-quote-ar.png"), fullPage: true, caret: "initial" });

  // What the Mac reads for "Put them all in the book".
  const { data: texts } = await admin().from("book_texts").select("kind, class_name, student_code, body").eq("book_id", bookId).order("created_at");
  expect(texts).toHaveLength(2);
  expect(texts![0]).toMatchObject({ kind: "quote", class_name: "4A", student_code: omar });
  expect(texts![1]).toMatchObject({ kind: "quote", class_name: "5B", student_code: sara });
  // The Mac places a quote by its student_code on the class pages that hold
  // that student (desktop/src/core/book-texts.test.ts covers that step).
  expect(errors).toEqual([]);
});
