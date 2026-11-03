import { defineConfig } from "@playwright/test";

// Robot tests for the Mac/Windows app: they start the real app with an
// empty test library and click through it.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
});
