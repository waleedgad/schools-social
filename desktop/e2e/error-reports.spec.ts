import { _electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Errors in the Mac app reach the builder by themselves (quality plan,
// Phase 1): from the window and from the app's background work. Kept on the
// Mac until it is connected. Needs the test database.
const root = path.join(__dirname, "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
test.skip(!url || !anon || !service, "needs the test database (source e2e/test-db.env)");

test("errors in the window and in the background are reported, and the app keeps going", async () => {
  test.setTimeout(120_000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  // Letters only: numbers are ignored when telling errors apart.
  const tag = `mac-robot-${Math.random().toString(36).replace(/[^a-z]/g, "")}`;
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, server: "http://127.0.0.1:9", supabaseUrl: url, supabaseAnonKey: anon }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  await expect(win.locator('button.nav[data-go="library"]')).toBeVisible({ timeout: 30_000 });

  await win.evaluate((tag) => setTimeout(() => { throw new Error(`${tag} window`); }), tag);
  await app.evaluate((_e, tag) => { setTimeout(() => { throw new Error(`${tag} background`); }); }, tag);
  const rows = async () => (await admin.from("error_reports").select("source, message, version").like("message", `%${tag}%`).order("source")).data ?? [];
  await expect.poll(async () => (await rows()).length, { timeout: 30_000 }).toBe(2);
  const found = await rows();
  expect(found.map((r) => r.source)).toEqual(["mac", "mac-window"]);
  expect(found[0].version).toMatch(/^\d+\.\d+\.\d+/);
  // Still answering after an error in the background.
  await win.locator('button.nav[data-go="students"]').click();
  await expect(win.locator('button.nav.on[data-go="students"]')).toBeVisible();
  // Sent, so nothing left waiting on the Mac; and it is in the Mac's own log.
  expect(JSON.parse(readFileSync(path.join(userData, "errors.json"), "utf8"))).toEqual([]);
  expect(readFileSync(path.join(userData, "app.log"), "utf8")).toContain(`${tag} background`);
  await app.close();
});
