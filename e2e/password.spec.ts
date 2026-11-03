import { expect, test } from "@playwright/test";
import { newSchool } from "./helpers";

// Forgot password (bug B-23): ask for a link, open it, set a new password,
// then sign in with it. The test database catches the email in its own
// test mailbox, so the robot opens the real link.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const MAILBOX = "http://127.0.0.1:54324";

// Waits for the newest email to this address and returns its first link.
async function emailLink(to: string) {
  for (let i = 0; i < 40; i++) {
    const box = await (await fetch(`${MAILBOX}/api/v1/search?query=to:${encodeURIComponent(to)}`)).json();
    if (box.messages?.length) {
      const msg = await (await fetch(`${MAILBOX}/api/v1/message/${box.messages[0].ID}`)).json();
      const href = (msg.HTML as string).match(/href="([^"]+)"/)?.[1];
      if (href) return href.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email arrived for ${to}`);
}

test("forgot password, set a new one and sign in with it", async ({ page }, info) => {
  test.setTimeout(120_000);
  const email = await newSchool(page, `pw-${info.project.name}`);
  await page.context().clearCookies();

  await page.goto("/en/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/en\/forgot/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.locator("body")).toContainText("a link is on its way");

  // Open the link from the email, as caught by the test mailbox.
  const link = await emailLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/en\/new-password/);

  await page.getByLabel("New password").fill("Brand-new-pass-456");
  await page.getByLabel("Type it again").fill("Brand-new-pass-457");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator("body")).toContainText("don't match");
  await page.getByLabel("New password").fill("Brand-new-pass-456");
  await page.getByLabel("Type it again").fill("Brand-new-pass-456");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator("body")).toContainText("Your new password is saved");

  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").fill("Brand-new-pass-456");
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/en\/today/);
});

test("signed-in staff can change their password from the menu", async ({ page }, info) => {
  await newSchool(page, `pw2-${info.project.name}`);
  await page.goto("/en/today");
  // On a phone the menu is folded away behind the menu button.
  if (info.project.name === "phone") await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/en\/new-password/);
});
