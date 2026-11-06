import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { can, type Permission, type PermissionOverrides, type Role } from "../src/lib/roles";

// Release 0.8, item 1: who can do what. Every role signs in and opens every
// page; a page opens only for the roles allowed to use it, the rest are sent
// back. Then the admin unticks abilities for a role, and the pages follow
// the school's own choices (B-52: some pages ignored them).
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, service, { auth: { persistSession: false } });

// Each page and the ability it needs ("admin" = the admin only).
const PAGES: [string, Permission | "admin"][] = [
  ["/posts", "viewPosts"],
  ["/posts/new", "writePosts"],
  ["/calendar", "viewPosts"],
  ["/inbox", "writePosts"],
  ["/library", "viewLibrary"],
  ["/students", "manageConsent"],
  ["/analytics", "viewAnalytics"],
  ["/activity", "viewActivity"],
  ["/settings", "manageSettings"],
  ["/staff", "admin"],
];
const ROLES: Role[] = ["comms_lead", "comms", "principal", "teacher", "staff", "photographer"];

const consoleErrors: string[] = [];
async function signIn(page: Page, email: string) {
  if (!consoleErrors.length) {
    page.on("pageerror", (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
    consoleErrors.push("(listening)");
  }
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page, `${email}\n${consoleErrors.join("\n")}`).not.toHaveURL(/\/en\/login/, { timeout: 20_000 });
}

async function opens(page: Page, path: string) {
  await page.goto(`/en${path}`);
  await page.waitForLoadState("domcontentloaded");
  return new URL(page.url()).pathname === `/en${path}`;
}

test("every role sees only its own pages, and the school's own choices count", async ({ page }) => {
  test.setTimeout(300_000);
  const { data: school } = await admin().from("schools").insert({ name: "Roles school" }).select("id").single();
  const schoolId = school!.id as string;
  const people: Record<string, string> = {};
  for (const role of ROLES) {
    const email = `role-${role}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
    const { data: u } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
    await admin().from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role, full_name: `Test ${role}` });
    people[role] = email;
  }
  const check = async (overrides: PermissionOverrides | null, roles: Role[]) => {
    const wrong: string[] = [];
    for (const role of roles) {
      await signIn(page, people[role]);
      for (const [path, need] of PAGES) {
        const allowed = need === "admin" ? false : can(role, need, overrides);
        const got = await opens(page, path);
        if (got !== allowed) wrong.push(`${role} ${path}: ${got ? "opened" : "sent back"}, should be ${allowed ? "opened" : "sent back"}`);
      }
    }
    expect(wrong).toEqual([]);
  };

  // 1. The standard rights.
  await check(null, ROLES);

  // 2. The admin unticks some abilities for comms and gives the principal one more.
  const overrides: PermissionOverrides = { comms: { viewLibrary: false, manageConsent: false, viewAnalytics: false }, principal: { viewActivity: false, manageConsent: true } };
  await admin().from("schools").update({ permissions: overrides }).eq("id", schoolId);
  await check(overrides, ["comms", "principal"]);
});
