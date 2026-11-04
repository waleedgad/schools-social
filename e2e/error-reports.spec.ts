import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { newSchool } from "./helpers";

// Errors reach the builder by themselves (quality plan, Phase 1).
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test("an error on a page is reported once, counted, and nobody else can read it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  // Letters only: numbers are ignored when telling errors apart.
  const tag = `robot-${Math.random().toString(36).replace(/[^a-z]/g, "")}`;
  await newSchool(page, "errors");
  for (const n of [1, 2]) {
    await page.goto("/en/today");
    // An error in the page that nothing catches, with a different number each time.
    await page.evaluate(([tag, n]) => setTimeout(() => { throw new Error(`${tag} broke on item ${n}`); }), [tag, n] as const);
    await expect
      .poll(async () => (await admin().from("error_reports").select("*").like("message", `%${tag}%`)).data?.[0]?.count ?? 0, { timeout: 15_000 })
      .toBe(n);
  }
  const { data: rows } = await admin().from("error_reports").select("*").like("message", `%${tag}%`);
  expect(rows).toHaveLength(1);
  expect(rows![0]).toMatchObject({ source: "web", place: "/en/today", count: 2 });
  expect(rows![0].school_id).not.toBeNull();

  // Signed in or not, nobody can read or change reports through the website.
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  expect((await anon.from("error_reports").select("*")).data ?? []).toEqual([]);
  expect((await anon.from("error_reports").delete().like("message", `%${tag}%`).select()).data ?? []).toEqual([]);
  // Rubbish is ignored rather than stored.
  await anon.rpc("report_error", { p_source: "not-a-source", p_version: "x", p_message: tag, p_stack: "", p_place: "" });
  expect((await admin().from("error_reports").select("id").eq("message", tag)).data).toEqual([]);
});
