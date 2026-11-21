import { expect, test } from "@playwright/test";
import { downloadUrl, imageKind, sourceOf } from "../src/lib/cloud-links";
import { newSchool, watchErrors } from "./helpers";

// Photos from Google Drive, OneDrive and Dropbox (release 0.15). Shared
// links are turned into download addresses; the server only ever fetches
// from those services (never another site or the server's own network);
// only real photos come back. The real services aren't reached from tests.

test("shared links become download addresses; other sites are refused", () => {
  expect(downloadUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing")).toBe("https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t");
  expect(downloadUrl("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toContain("id=1AbCdEfGhIjKlMnOp");
  expect(downloadUrl("https://www.dropbox.com/scl/fi/abc123/IMG_1.jpg?rlkey=xyz&dl=0")).toBe("https://www.dropbox.com/scl/fi/abc123/IMG_1.jpg?rlkey=xyz&dl=1");
  expect(downloadUrl("https://1drv.ms/i/s!AbCdEf")).toMatch(/^https:\/\/api\.onedrive\.com\/v1\.0\/shares\/u!/);
  for (const bad of ["http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view", "https://example.com/a.jpg", "https://drive.google.com.evil.com/file/d/1AbCdEfGhIjKlMnOp", "https://127.0.0.1/x", "https://user:pw@www.dropbox.com/s/a/b.jpg", "https://www.dropbox.com:444/s/a/b.jpg", "https://www.googleapis.com/drive/v3/files/abc?alt=media"]) {
    expect(downloadUrl(bad), bad).toBeNull();
  }
  expect(sourceOf("https://x.files.1drv.com/y/download")).toBe("onedrive");
  expect(sourceOf("https://169.254.169.254/latest")).toBeNull();
  expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  expect(imageKind(new TextEncoder().encode("<!doctype html><html>"))).toBeNull();
});

test.describe("with the test website", () => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

  test("the upload page refuses links that aren't Drive, OneDrive or Dropbox photos", async ({ page }) => {
    await newSchool(page, "cloud");
    const errors = watchErrors(page);
    // Signed out: nothing is fetched.
    const anon = await page.context().browser()!.newContext();
    const r0 = await anon.request.post("/api/import-link", { data: { url: "https://www.dropbox.com/s/a/b.jpg" } });
    expect(r0.status()).toBe(401);
    await anon.close();
    // Signed in: other sites, the server's own network and bad Google ids are refused.
    for (const url of ["https://example.com/a.jpg", "http://127.0.0.1:3123/", "https://169.254.169.254/latest/meta-data", "file:///etc/passwd"]) {
      const r = await page.request.post("/api/import-link", { data: { url } });
      expect(r.status(), url).toBe(400);
    }
    const r2 = await page.request.post("/api/import-link", { data: { fileId: "../../etc", token: "x" } });
    expect(r2.status()).toBe(400);

    await page.goto("/en/upload");
    const box = page.getByTestId("cloud-import");
    await box.locator("summary").click();
    await box.locator("textarea").fill("https://example.com/photo.jpg");
    await box.getByRole("button", { name: "Add these photos" }).click();
    await expect(box).toContainText("isn't a Google Drive, OneDrive or Dropbox photo");
    await page.screenshot({ path: test.info().outputPath("cloud-import.png"), fullPage: true });
    // The refused link's 400 answer is expected; nothing else may go wrong.
    expect(errors.filter((e) => !e.includes("status of 400"))).toEqual([]);
  });
});
