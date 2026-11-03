import { defineConfig, devices } from "@playwright/test";

// Robot tests for the website. They start the built site and click through
// it like a person would, on a desktop and a phone screen.
export default defineConfig({
  testDir: "e2e",
  // One retry on GitHub; a test that only passes on retry is reported as
  // "flaky" in the results, so it stays visible (see bug B-25).
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  use: {
    baseURL: "http://localhost:3123",
    screenshot: "on",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx next start -p 3123",
    url: "http://localhost:3123/en/login",
    reuseExistingServer: false,
  },
});
