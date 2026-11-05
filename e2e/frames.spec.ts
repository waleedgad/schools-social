import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { newSchool, watchErrors } from "./helpers";

// B-43: a school uploads its frame (a PNG with a see-through middle). Photo
// storage used to refuse PNG files, so every frame upload failed.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

test("a school's PNG frame uploads and is listed", async ({ page }) => {
  test.setTimeout(90_000);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = await newSchool(page, "frames");
  const errors = watchErrors(page);
  const png = await sharp({ create: { width: 1080, height: 1350, channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } } })
    .composite([{ input: await sharp({ create: { width: 980, height: 1250, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 50, top: 50, blend: "dest-out" }])
    .png()
    .toBuffer();
  await page.goto("/en/categories?tab=frames");
  await page.locator('input[type="file"][name="file"]').setInputFiles({ name: "school-frame.png", mimeType: "image/png", buffer: png });
  await page.getByPlaceholder("Name").fill("Blue school frame");
  await page.getByRole("button", { name: "Add frame" }).click();
  await expect(page.locator("main")).toContainText("Blue school frame", { timeout: 20_000 });
  await expect(page.locator("main")).not.toContainText("Choose a PNG file and try again");

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userId = users.users.find((u) => u.email === email)!.id;
  const { data: m } = await admin.from("memberships").select("school_id").eq("user_id", userId).single();
  const { data: frames } = await admin.from("frames").select("name, storage_path").eq("school_id", m!.school_id);
  expect(frames).toHaveLength(1);
  const file = (await admin.storage.from("photos").download(frames![0].storage_path as string)).data!;
  expect((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).hasAlpha).toBe(true);
  expect(errors).toEqual([]);
});
