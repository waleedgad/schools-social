import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { newSchool, watchErrors } from "./helpers";

// Release 0.16: the whole caption flow with an AI key, against a stand-in
// for Gemini (e2e/fake-meta.mjs) that answers with messy text on purpose.
// The website must show clean captions: Arabic punctuation, the school's own
// hashtags first and no repeats, the version with a word for children and a
// banned word dropped, and only a WARNING for a student's name (Waleed,
// 17 Nov 2026). Runs in English and in Arabic.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));
test.use({ baseURL: "http://localhost:3124" });

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const words = {
  en: { panel: "AI writer", write: /^(✨ )?Write (captions|new versions)$/, captionAr: "Caption in Arabic", captionEn: "Caption in English", check: "Check the caption", name: "The caption names a student" },
  ar: { panel: "كاتب الذكاء الاصطناعي", write: /^(✨ )?اكتب (النص|نسخاً جديدة)$/, captionAr: "النص بالعربية", captionEn: "النص بالإنجليزية", check: "افحص النص", name: "النص يذكر اسم طالب" },
};

test("AI captions come back clean, in English and in Arabic", async ({ page }, info) => {
  test.setTimeout(180_000);
  await newSchool(page, `captions-${info.project.name}`);
  const errors = watchErrors(page);
  await page.goto("/en/posts/new");
  await page.getByLabel(/what is it about/i).fill("Sports day for Grade 4");
  await page.getByRole("button", { name: /start writing/i }).click();
  await expect(page).toHaveURL(/\/en\/posts\/[0-9a-f-]+/);
  const id = page.url().match(/posts\/([0-9a-f-]+)/)![1];

  // The school's own hashtags, a banned word and a student whose name the AI will use.
  const { data: post } = await admin().from("posts").select("school_id").eq("id", id).single();
  const schoolId = post!.school_id as string;
  await admin().from("schools").update({ hashtags: "#AlNourTest" }).eq("id", schoolId);
  await admin().from("snippets").insert({ school_id: schoolId, kind: "avoid", title: "Never", body: "cheap" });
  await admin().from("students").insert({ school_id: schoolId, full_name: "Omar Hassan", class_name: "4A", stage: "Grade 4", student_code: `cap${Date.now()}` });

  for (const locale of ["en", "ar"] as const) {
    const w = words[locale];
    await page.goto(`/${locale}/posts/${id}`);
    await page.getByRole("button", { name: w.panel, exact: true }).click();
    await page.getByRole("button", { name: w.write }).click();
    await expect(page).toHaveURL(/ai=done/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    // The clean version filled the post; the messy one was dropped.
    await expect(page.getByLabel(w.captionAr)).toHaveValue("طلابنا في يوم رياضي رائع، شكرًا لكل من شارك");
    await expect(page.getByLabel(w.captionEn)).toHaveValue("A great sports day for our students. Well done, Omar Hassan!");
    const saved = (await admin().from("posts").select("hashtags, variations").eq("id", id).single()).data!;
    expect(saved.hashtags).toBe("#AlNourTest #SportsDay #يوم_رياضي");
    expect(saved.variations).toHaveLength(1);

    // B-139: in the preview the English line reads left-to-right under the Arabic one, as on Facebook.
    const englishLine = page.locator("span[dir=auto]", { hasText: "A great sports day for our students" }).first();
    expect(await englishLine.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    const arabicLine = page.locator("span[dir=auto]", { hasText: "طلابنا في يوم رياضي رائع" }).first();
    expect(await arabicLine.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");

    // A student's name only warns: the warning shows and Approve is still there.
    await expect(page.getByText(w.name).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`captions-${locale}.png`), fullPage: true, caret: "initial" });

    // The caption check finds a word for children itself, whatever the AI says.
    await page.getByLabel(w.captionAr).fill("أطفالنا في يوم رياضي رائع");
    await page.getByRole("button", { name: w.panel, exact: true }).click();
    await page.getByRole("button", { name: w.check }).click();
    await expect(page.getByText(/Uses a word the school avoids: .*أطفال/)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: info.outputPath(`caption-check-${locale}.png`), fullPage: true, caret: "initial" });
  }

  // What went to the AI carried the school's rules.
  const calls = (await (await fetch("http://127.0.0.1:3998/__calls?prefix=/gemini/")).json()) as { prompt: string }[];
  const caption = calls.find((c) => c.prompt.includes("caption option"))!;
  for (const part of ["Arabic rules:", "English rules:", "cheap", "أطفال", "Sports day for Grade 4"]) expect(caption.prompt).toContain(part);
  const check = calls.find((c) => c.prompt.includes("Check this caption"))!;
  expect(check.prompt).toContain("cheap");
  expect(errors).toEqual([]);
});
