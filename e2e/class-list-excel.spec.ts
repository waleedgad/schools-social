import { expect, test } from "@playwright/test";
import path from "node:path";
import { newSchool, watchErrors } from "./helpers";

// A school imports its class list as an Excel file. The Excel reader moved to
// a new version in 0.14 (read-excel-file 9, Dependabot), which changed how it
// is loaded; the site build broke on the update. This proves an .xlsx class
// list still reads: 63 fake students in 3 classes (e2e/fixtures/class-list.xlsx).
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

test("an Excel class list is read and imported", async ({ page }) => {
  test.setTimeout(90_000);
  await newSchool(page, "excel");
  const errors = watchErrors(page);
  await page.goto("/en/students");
  await page.locator('input[type="file"][accept=".xlsx,.csv"]').setInputFiles(path.join(__dirname, "fixtures", "class-list.xlsx"));
  await expect(page.getByText("63 students found.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Import them" }).click();
  await expect(page.locator("main")).toContainText("Omar Tamer Farouk", { timeout: 20_000 });
  expect(errors).toEqual([]);
});
