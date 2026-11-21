import { defineConfig } from "@playwright/test";

// Runs only the Meta Graph tests: no website, no database, no browser.
//   npx playwright test -c e2e/meta.config.ts
export default defineConfig({
  testDir: ".",
  testMatch: "meta-graph.spec.ts",
  reporter: [["list"]],
  projects: [{ name: "desktop" }],
});
