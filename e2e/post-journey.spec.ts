import { expect, test } from "@playwright/test";
import { newSchool, watchErrors } from "./helpers";

// The comms lead writes a text-only post. With no AI key set (as on the
// test database) the post must still open for writing, not hang or crash.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

test("write, approve and find a text-only post", async ({ page }, info) => {
  test.setTimeout(120_000);
  await newSchool(page, `post-${info.project.name}`);
  const errors = watchErrors(page);
  await page.goto("/en/posts/new");
  await page.getByLabel(/what is it about/i).fill("Open day on Saturday for new families");
  await page.getByRole("button", { name: /start writing/i }).click();
  await expect(page).toHaveURL(/\/en\/posts\/[0-9a-f-]+/);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: info.outputPath("composer.png"), fullPage: true });

  // Write both captions by hand and approve (the lead may approve their own posts).
  await page.getByLabel("Caption in Arabic").fill("يوم مفتوح يوم السبت للعائلات الجديدة");
  await page.getByLabel("Caption in English").fill("Open day on Saturday for new families. Everyone is welcome!");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

  // It shows on the Posts board, and the captions were saved.
  const url = page.url();
  await page.goto("/en/posts");
  await expect(page.locator("body")).toContainText("يوم مفتوح يوم السبت");
  await page.goto(url);
  await expect(page.getByLabel("Caption in Arabic")).toHaveValue(/يوم مفتوح/);
  expect(errors).toEqual([]);
});
