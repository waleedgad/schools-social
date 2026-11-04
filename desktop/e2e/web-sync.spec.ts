import { _electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// The Mac app and the website together, against the private test database
// (only runs when it is up: the website job in the automatic checks).
// B-17 only picked photos are sent; B-18 a post's photos go even while
// sending is paused; B-21 deleting on the Mac removes the web copy.
const root = path.join(__dirname, "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
test.skip(!url || !anon || !service, "needs the test database (source e2e/test-db.env)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<unknown> } };

test("only picked photos are sent; post photos go while paused; deleting removes the web copy", async () => {
  test.setTimeout(240_000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const email = `mac-${Date.now()}@example.com`;
  const password = "test-password-123";
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(ue).toBeNull();
  const { data: school, error: se } = await admin.from("schools").insert({ name: "Mac sync school" }).select("id").single();
  expect(se).toBeNull();
  const { error: me } = await admin.from("memberships").insert({ school_id: school!.id, user_id: u.user!.id, role: "admin", full_name: "Mac Tester" });
  expect(me).toBeNull();
  const webPhotos = async () => ((await admin.from("photos").select("id, original_name").eq("school_id", school!.id)).data ?? []).map((p) => p.original_name as string).sort();

  const base = mkdtempSync(path.join(tmpdir(), "hub-sync-"));
  const lib = path.join(base, "Photos");
  const ev = path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  for (let i = 0; i < 3; i++) {
    const img = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 60 * i, g: 140, b: 200 - 50 * i } } })
      .composite([{ input: Buffer.from(`<svg width="800" height="600"><rect x="${100 + i * 200}" y="50" width="80" height="500" fill="white"/></svg>`), top: 0, left: 0 }])
      .jpeg()
      .toBuffer();
    writeFileSync(path.join(ev, `IMG_${3000 + i}.jpg`), img);
  }
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false, sendMode: "picked", server: "http://127.0.0.1:9", supabaseUrl: url, supabaseAnonKey: anon }),
  );
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  await win.evaluate(([e, p]) => (window as unknown as Hub).hub.call("signIn", e, p), [email, password]);
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(3);
  const ids = (await win.evaluate("lib.list.map((p) => [p.name, p.id])")) as [string, number][];
  const id = (name: string) => ids.find(([n]) => n === name)![1];

  // B-17: nothing is picked, so nothing goes. Then pick one: only that one goes.
  await win.waitForTimeout(6000);
  expect(await webPhotos()).toEqual([]);
  await win.evaluate((x) => (window as unknown as Hub).hub.call("flag", [x], 1), id("IMG_3000.jpg"));
  await expect.poll(webPhotos, { timeout: 60_000 }).toEqual(["IMG_3000.jpg"]);

  // B-18: sending paused; a photo for a post still goes straight away.
  await win.evaluate(() => (window as unknown as Hub).hub.call("set", "paused", true));
  const file = path.join(ev, "IMG_3001.jpg");
  const started = Date.now();
  await win.evaluate((f) => (window as unknown as Hub).hub.call("sendNow", f), file);
  expect(Date.now() - started).toBeLessThan(30_000);
  expect(await webPhotos()).toEqual(["IMG_3000.jpg", "IMG_3001.jpg"]);
  // Picking while paused waits for resume.
  await win.evaluate((x) => (window as unknown as Hub).hub.call("flag", [x], 1), id("IMG_3002.jpg"));
  await win.waitForTimeout(6000);
  expect(await webPhotos()).toEqual(["IMG_3000.jpg", "IMG_3001.jpg"]);

  // B-21: deleting on the Mac removes the web copy.
  await win.evaluate((x) => (window as unknown as Hub).hub.call("bin", [x]), id("IMG_3000.jpg"));
  await expect.poll(webPhotos, { timeout: 30_000 }).toEqual(["IMG_3001.jpg"]);
  await app.close();
});
