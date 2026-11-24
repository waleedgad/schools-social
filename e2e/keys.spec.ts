import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { watchErrors } from "./helpers";

// Release 0.17: Owner > Keys and switches lists every free key, on or off,
// with the exact Vercel name to add; Test asks the service; only the owner
// can open it. Google / Microsoft sign-in buttons show only when switched on.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const password = "Test-password-123";
const admin = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function person(tag: string) {
  const email = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { email, id: data.user!.id };
}

async function signIn(page: Page, email: string, base = "") {
  await page.context().clearCookies();
  await page.goto(`${base}/en/login`);
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).not.toHaveURL(/\/en\/login/, { timeout: 20_000 });
}

test("the owner sees which keys are on and exactly what to add", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = watchErrors(page);
  const owner = await person("keys-owner");
  await admin().from("owners").insert({ user_id: owner.id });
  await signIn(page, owner.email);
  await page.goto("/en/owner/keys");
  await expect(page.getByRole("heading", { name: "Keys and switches", level: 1 })).toBeVisible();
  const item = (key: string) => page.locator(`[data-key="${key}"]`);
  // The test site has its database and address, but no Meta app and no Gemini key.
  await expect(item("database")).toContainText("On");
  await expect(item("meta")).toContainText("Off");
  await expect(item("meta").locator("code").first()).toHaveText("META_APP_ID");
  await expect(item("gemini")).toContainText("GEMINI_API_KEY");
  // Sign-in with Google is switched on in Supabase, not in Vercel.
  await expect(item("googleSignIn")).toContainText("Switch it on in Supabase");
  // Email waits for the email release.
  await expect(page.getByRole("list", { name: "Later" }).locator('[data-key="email"]')).toContainText("L-40");
  // Never a key's value: the service key of the test database isn't on the page.
  expect(await page.content()).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  await page.screenshot({ path: test.info().outputPath("keys-en.png"), fullPage: true });
  await page.goto("/ar/owner/keys");
  await expect(page.getByRole("heading", { name: "المفاتيح والتشغيل", level: 1 })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("keys-ar.png"), fullPage: true });

  // The site with a Gemini key (port 3124, stand-in Gemini): Test says it works.
  await signIn(page, owner.email, "http://localhost:3124");
  await page.goto("http://localhost:3124/en/owner/keys");
  await expect(item("gemini")).toContainText("On");
  await item("gemini").getByRole("button", { name: "Test" }).click();
  await expect(page.getByText("AI (Gemini): the key works.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("only the owner can open Keys and switches; no sign-in buttons until switched on", async ({ page }) => {
  const a = await person("keys-admin");
  const { data: s } = await admin().from("schools").insert({ name: "Keys admin school" }).select("id").single();
  await admin().from("memberships").insert({ school_id: s!.id, user_id: a.id, role: "admin", full_name: "Admin" });
  await page.goto("/en/login");
  // The local test database has Google and Microsoft switched off.
  await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Microsoft/ })).toHaveCount(0);
  await signIn(page, a.email);
  await page.goto("/en/owner/keys");
  await expect(page).not.toHaveURL(/\/owner\/keys/);
});
