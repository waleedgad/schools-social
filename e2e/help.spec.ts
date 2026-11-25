import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { newSchool, watchErrors } from "./helpers";

// Help has a short guide for each feature added in 0.13 to 0.17, in Arabic
// and English; search finds them; the owner page guide is only for owners.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const NEW = {
  en: ["AI captions in your school's voice", "When a post doesn't go out", "Check connection", "Inbox, private messages and saved replies", "Yearbooks and graduation books", "Photos from Google Drive, OneDrive or Dropbox", "Alerts, class lists and sign-in", "Easier reading, dark mode and the keyboard"],
  ar: ["نصوص الذكاء الاصطناعي بأسلوب مدرستك", "عندما لا يُنشر المنشور", "فحص الربط", "صندوق الرسائل والرسائل الخاصة والردود المحفوظة", "الكتب السنوية وكتب التخرج", "صور من جوجل درايف أو ون درايف أو دروب بوكس", "التنبيهات وقوائم الفصول وتسجيل الدخول", "قراءة أسهل والوضع الداكن ولوحة المفاتيح"],
};

for (const locale of ["en", "ar"] as const) {
  test(`Help explains the new features (${locale})`, async ({ page }, info) => {
    await newSchool(page, `help-${info.project.name}-${locale}`);
    const errors = watchErrors(page);
    await page.goto(`/${locale}/help`);
    for (const title of NEW[locale]) await expect(page.getByText(title, { exact: true })).toBeVisible();
    // A school never sees the owner page guide.
    await expect(page.locator("#guide-owner")).toHaveCount(0);
    // Open a guide: its text shows.
    await page.locator("#guide-posting summary").click();
    await expect(page.locator("#guide-posting")).toContainText(locale === "en" ? "5, 15 and 45 minutes" : "5 و15 و45 دقيقة");
    if (process.env.HELP_SHOTS) {
      await page.locator("#guide-captions summary").click();
      await page.locator("#guide-inbox summary").click();
      await page.screenshot({ path: `${process.env.HELP_SHOTS}/help-${info.project.name}-${locale}.png`, fullPage: true });
    }
    // Search finds a guide by a word in its text.
    await page.goto(`/${locale}/help?q=${encodeURIComponent(locale === "en" ? "saved replies" : "الردود المحفوظة")}`);
    await expect(page.locator("#guide-inbox")).toBeVisible();
    await expect(page.locator("#guide-start")).toHaveCount(0);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(locale === "en" ? /\bchild(ren)?\b/i : /أطفال|طفل/);
    expect(errors).toEqual([]);
  });
}

test("the owner page guide shows for an owner", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "runs once, not per screen size");
  const email = await newSchool(page, "help-owner");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const me = data.users.find((u) => u.email === email);
  await admin.from("owners").insert({ user_id: me!.id });
  for (const [locale, words] of [["en", "Keys and switches"], ["ar", "المفاتيح والتشغيل"]] as const) {
    await page.goto(`/${locale}/help`);
    await page.locator("#guide-owner summary").click();
    await expect(page.locator("#guide-owner")).toContainText(words);
    if (process.env.HELP_SHOTS) await page.locator("#guide-owner").screenshot({ path: `${process.env.HELP_SHOTS}/help-owner-${locale}.png` });
  }
});
