import { createClient } from "@supabase/supabase-js";
import { test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { newSchool } from "./helpers";

// Exploratory: records every page while it opens, sits still and while the
// person moves around, and prints what moved. Run with MOTION_SWEEP=1.
test.skip(!process.env.MOTION_SWEEP || !process.env.NEXT_PUBLIC_SUPABASE_URL, "exploratory sweep");
const RECORDER = readFileSync(path.join(__dirname, "motion-recorder.js"), "utf8");
const PAGES = [
  "today", "library", "upload", "posts", "posts/new", "posts/new/announcement", "calendar",
  "inbox", "coverage", "students", "staff", "albums", "books", "shots", "categories",
  "analytics", "digest", "reports", "activity", "accounts", "settings", "help", "setup", "check",
];

async function seed(email: string) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const me = users.users.find((u) => u.email === email)!;
  const { data: mem } = await db.from("memberships").select("school_id").eq("user_id", me.id).single();
  const school = mem!.school_id as string;
  const now = Date.now();
  const { data: events } = await db.from("events").insert([0, 1, 2].map((e) => ({ school_id: school, title: `Event ${e}`, event_date: new Date(now - e * 5 * 86400_000).toISOString().slice(0, 10), created_by: me.id }))).select("id");
  const photos: Record<string, unknown>[] = [];
  for (let i = 0; i < 30; i++) {
    const id = crypto.randomUUID();
    const p = `${school}/sweep/${i}.jpg`;
    const img = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: (i * 37) % 255, g: (i * 91) % 255, b: (i * 53) % 255 } } }).jpeg().toBuffer();
    const t = await sharp(img).resize(400).jpeg().toBuffer();
    await db.storage.from("photos").upload(p, img, { contentType: "image/jpeg", upsert: true });
    await db.storage.from("photos").upload(p.replace(/\.jpg$/, "_t.jpg"), t, { contentType: "image/jpeg", upsert: true });
    photos.push({ id, school_id: school, event_id: events![i % 3].id, uploaded_by: me.id, source: "desktop", storage_path: p, width: 1200, height: 900, original_name: `IMG_${i}.jpg`, taken_at: new Date(now - i * 3600_000).toISOString(), ai_score: (i % 10) + 1, check_status: "ready" });
  }
  await db.from("photos").insert(photos);
  const statuses = ["idea", "draft", "in_review", "approved", "scheduled", "published"];
  const posts = Array.from({ length: 24 }, (_, i) => {
    const status = statuses[i % statuses.length];
    const at = new Date(now + (i - 12) * 86400_000).toISOString();
    return { id: crypto.randomUUID(), school_id: school, event_id: events![i % 3].id, status, caption_en: `Post ${i}: a day at school`, caption_ar: `منشور ${i}`, created_by: me.id, scheduled_at: ["scheduled", "approved", "published"].includes(status) ? at : null, published_at: status === "published" ? at : null };
  });
  await db.from("posts").insert(posts);
  await db.from("post_photos").insert(posts.flatMap((p, i) => [0, 1].map((k) => ({ post_id: p.id, photo_id: photos[(i * 2 + k) % 30].id as string, school_id: school, position: k }))));
}

const take = (page: Page) => page.evaluate(() => (window as unknown as { __motion?: { take: () => unknown[] } }).__motion?.take() ?? []);

for (const locale of ["en", "ar"] as const) {
  test(`website sweep ${locale}`, async ({ page }, info) => {
    test.setTimeout(1_800_000);
    const email = await newSchool(page, `motion-${info.project.name}-${locale}`);
    await seed(email);
    await page.addInitScript(RECORDER);
    const report: Record<string, { kind: string; [k: string]: unknown }[]> = {};
    try {
    for (const p of PAGES) {
      await page.goto(`/${locale}/${p}`);
      await page.waitForTimeout(2500);
      report[`${p} open`] = (await take(page)) as never;
      await page.waitForTimeout(3000);
      report[`${p} idle`] = (await take(page)) as never;
      // Scroll down a bit and click the first few buttons and tabs that
      // don't leave the page.
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(500);
      const url = page.url();
      const here = new URL(page.url()).pathname;
      const clickable = [
        ...(await page.locator("main a[href*='?']:visible").all()).filter(async () => true),
        ...(await page.locator("main button:visible, main summary:visible, main [role=tab]:visible").filter({ hasNotText: /delete|remove|sign out|publish|reject|archive|leave|بلا|حذف|إزالة|نشر|رفض|خروج/i }).all()),
      ];
      for (const c of clickable.slice(0, 8)) {
        const href = await c.getAttribute("href").catch(() => null);
        if (href && new URL(href, page.url()).pathname !== here) continue;
        if (!(await c.isEnabled().catch(() => false))) continue;
        await c.click({ timeout: 800 }).catch(() => {});
        await page.waitForTimeout(800);
        await page.keyboard.press("Escape");
        if (page.url() !== url) await page.goto(url);
      }
      await page.waitForTimeout(800);
      report[`${p} clicks`] = (await take(page)) as never;
    }
    // Moving between pages with the menu (no full page load).
    await page.goto(`/${locale}/today`);
    await page.waitForTimeout(1500);
    await take(page);
    const links = await page.locator("nav a[href]:visible").all();
    for (const l of links.slice(0, 10)) {
      const href = await l.getAttribute("href");
      await l.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1800);
      report[`menu -> ${href}`] = (await take(page)) as never;
    }
    } finally {
    const summary: string[] = [];
    for (const [k, evs] of Object.entries(report)) {
      const by = new Map<string, number>();
      for (const e of evs) {
        const key = `${e.kind} ${e.name ?? ""} ${e.el ?? (e.els as string[] | undefined)?.join(",") ?? ""} ${e.kind === "long" ? e.ms + "ms " + (e.scripts as string[]).join(",") : ""}${e.kind === "shift" ? e.value : ""}${/scroll/.test(e.kind) ? `${e.from}->${e.to}` : ""}`;
        by.set(key, (by.get(key) ?? 0) + 1);
      }
      if (by.size) summary.push(`## ${k}\n` + [...by].map(([x, c]) => `  ${c}x ${x}`).join("\n"));
    }
    writeFileSync(path.join(tmpdir(), `web-motion-${info.project.name}-${locale}.txt`), summary.join("\n"));
    }
  });
}
