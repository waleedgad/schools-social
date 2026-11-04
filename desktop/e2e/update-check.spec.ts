import { _electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

// Update check: when the website says a newer version exists, the sidebar
// shows "Version x is ready"; opening it saves a safety copy of the library
// and shows the steps, including the one Terminal line for Mac.
const root = path.join(__dirname, "..");

test("a newer version shows the steps and saves a safety copy", async () => {
  test.setTimeout(90_000);
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ app: "school-social-hub", supabaseUrl: "http://127.0.0.1:9", supabaseAnonKey: "x", latest: { version: "99.0.0", url: "https://example.com/hub.zip", notes: "Faster import." } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const lib = path.join(mkdtempSync(path.join(tmpdir(), "hub-upd-")), "Photos");
  mkdirSync(lib, { recursive: true });
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false, server: url, supabaseUrl: "http://127.0.0.1:9", supabaseAnonKey: "x" }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  const bar = win.locator("#updatebar");
  await expect(bar).toContainText("Version 99.0.0 is ready", { timeout: 30_000 });
  await bar.click();
  await expect(win.locator("#overlay")).toContainText("Faster import.");
  await expect(win.locator("#up-copy")).toContainText("Done", { timeout: 20_000 });
  if (process.platform !== "win32") await expect(win.locator("#up-cmd")).toContainText("xattr -cr");
  const backups = path.join(userData, "backups");
  expect(existsSync(backups)).toBe(true);
  expect(existsSync(path.join(backups, readdirSync(backups)[0], "library.db"))).toBe(true);
  await win.screenshot({ path: test.info().outputPath("update-steps.png") });
  await app.close();
  server.close();
});

test("no notice when this is the newest version", async () => {
  test.setTimeout(60_000);
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ app: "school-social-hub", supabaseUrl: "http://127.0.0.1:9", supabaseAnonKey: "x", latest: { version: "0.0.1", url: "https://example.com/old.zip" } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, faces: false, server: url, supabaseUrl: "http://127.0.0.1:9", supabaseAnonKey: "x" }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  await win.evaluate(() => (window as unknown as { hub: { call: (f: string) => Promise<unknown> } }).hub.call("checkUpdate"));
  await win.waitForTimeout(1500);
  await expect(win.locator("#updatebar")).toHaveCount(0);
  await app.close();
  server.close();
});

test("with no download link, the steps say to take it from the Versions folder", async () => {
  test.setTimeout(90_000);
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ app: "school-social-hub", supabaseUrl: "http://127.0.0.1:9", supabaseAnonKey: "x", latest: { version: "99.0.0", url: null, notes: "" } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const lib = path.join(mkdtempSync(path.join(tmpdir(), "hub-upd-")), "Photos");
  mkdirSync(lib, { recursive: true });
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false, server: url, supabaseUrl: "http://127.0.0.1:9", supabaseAnonKey: "x" }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  await expect(win.locator("#updatebar")).toBeVisible({ timeout: 45_000 });
  await win.locator("#updatebar").click();
  await expect(win.locator("#up-where")).toContainText("Versions folder");
  await expect(win.locator("#up-dl")).toHaveCount(0);
  await app.close();
  server.close();
});
