import { _electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// 0.5 checklist "Nothing hangs": an import, the face scan of a fresh library
// and (when the test database is up) sending to the website all run at once
// while the robot keeps clicking through the tabs. Every click must answer
// quickly, the app must keep answering, the import shows its progress and
// can be stopped, and nothing crashes.
const root = path.join(__dirname, "..");
const TABS = ["today", "library", "import", "faces", "students", "coverage", "cleanup", "books", "posts", "calendar", "history", "settings", "help"];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const withWeb = Boolean(url && anon && service);

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };

async function photos(dir: string, n: number, seed: number, w = 1200, h = 900) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const s = seed + i;
    const img = await sharp({ create: { width: w, height: h, channels: 3, background: { r: (s * 37) % 255, g: (s * 91) % 255, b: (s * 53) % 255 } } })
      .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><rect x="${(s * 47) % (w - 100)}" y="40" width="90" height="${h - 80}" fill="white"/><circle cx="${w / 2}" cy="${h / 3}" r="${h / 8}" fill="#e0b090"/></svg>`), top: 0, left: 0 }])
      .jpeg({ quality: 80 })
      .toBuffer();
    writeFileSync(path.join(dir, `IMG_${String(s).padStart(5, "0")}.jpg`), img);
  }
}

test("import, face scan and sending at once: every click still answers", async () => {
  test.setTimeout(420_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-busy-"));
  const lib = path.join(base, "Photos");
  // A library the app has never read (thumbnails + faces to do), and a card to import.
  await photos(path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day"), 60, 0);
  await photos(path.join(lib, "2025-2026", "Term 1", "2025-10-20 Book week"), 60, 100);
  const card = path.join(base, "Card", "DCIM");
  await photos(card, 300, 1000, 1000, 750);

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  const settings: Record<string, unknown> = { language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: true, faceVision: false };
  let email = "";
  let sentToWeb = async () => 0;
  const password = "test-password-123";
  if (withWeb) {
    const admin = createClient(url!, service!, { auth: { persistSession: false } });
    email = `busy-${Date.now()}@example.com`;
    const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const { data: school } = await admin.from("schools").insert({ name: "Busy school" }).select("id").single();
    await admin.from("memberships").insert({ school_id: school!.id, user_id: u.user!.id, role: "admin", full_name: "Busy Tester" });
    sentToWeb = async () => (await admin.from("photos").select("id", { count: "exact", head: true }).eq("school_id", school!.id)).count ?? 0;
    Object.assign(settings, { sendMode: "all", server: "http://127.0.0.1:9", supabaseUrl: url, supabaseAnonKey: anon });
  }
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify(settings));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const out: string[] = [];
  app.process().stderr?.on("data", (d) => out.push(String(d)));
  app.process().stdout?.on("data", (d) => out.push(String(d)));
  const t0 = Date.now();
  const outFile = test.info().outputPath("app-output.txt");
  app.process().on("exit", (code, sig) => { out.push(`app ended: code ${code}, signal ${sig}, after ${Date.now() - t0} ms\n`); writeFileSync(outFile, out.join("")); });
  const win = await app.firstWindow();
  win.on("crash", () => out.push("WINDOW CRASHED"));
  // If the app dies, its last words are kept with the test results.
  win.on("close", () => writeFileSync(outFile, out.join("")));
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  const call = (f: string, ...a: unknown[]) => win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
  if (withWeb) expect((await call("signIn", email, password)).ok).toBe(true);
  // Watch for the window freezing: any task longer than this is a visible stall.
  await win.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: "longtask", buffered: false });
  });

  // Start the import while the library is still being read.
  await win.locator('button.nav[data-go="import"]').click();
  await win.evaluate((dir) => (window as unknown as { go: (v: string, p: object) => void }).go("import", { sources: [dir] }), card);
  await expect(win.locator("#i-go")).toBeEnabled({ timeout: 120_000 });
  const title = win.locator('[data-ev][data-f="title"]').first();
  if (!(await title.inputValue()).trim()) await title.fill("Sports day");
  await win.locator("#i-go").click();
  // The import shows its progress in the sidebar.
  await expect(win.locator(".macstatus .imp").first()).toBeVisible({ timeout: 30_000 });

  // Keep clicking through every tab while everything runs.
  const clicks: { tab: string; ms: number }[] = [];
  const answers: number[] = [];
  const until = Date.now() + 45_000;
  let busySeen = false;
  while (Date.now() < until) {
    for (const tab of TABS) {
      const t0 = Date.now();
      await win.locator(`button.nav[data-go="${tab}"]`).click();
      await expect(win.locator(`button.nav.on[data-go="${tab}"]`)).toBeVisible({ timeout: 10_000 });
      clicks.push({ tab, ms: Date.now() - t0 });
      const a0 = Date.now();
      const st = (await call("state")).value as { engine?: { processing?: number; faceQueue?: number }; imports?: { state: string }[]; queue?: { pending?: number } };
      answers.push(Date.now() - a0);
      if ((st.engine?.processing ?? 0) + (st.engine?.faceQueue ?? 0) > 0 && st.imports?.some((i) => i.state === "running")) busySeen = true;
    }
  }
  // The work really was running at the same time as the clicking.
  expect(busySeen).toBe(true);

  // Stop the import from its own page: it stops and keeps what was copied.
  await win.locator('button.nav[data-go="import"]').click();
  const stop = win.locator("[data-cancel]").first();
  if (await stop.isVisible().catch(() => false)) {
    await stop.click();
    await win.locator(".overlay [data-yes], [data-yes]").first().click();
    await expect
      .poll(async () => ((await call("importJobs")).value as { state: string }[]).filter((j) => j.state === "running" || j.state === "waiting").length, { timeout: 30_000 })
      .toBe(0);
    const jobs = (await call("importJobs")).value as { state: string }[];
    expect(jobs.some((j) => j.state === "cancelled" || j.state === "done")).toBe(true);
  }
  // Still answering after stopping.
  await win.locator('button.nav[data-go="library"]').click();
  await expect(win.locator('button.nav.on[data-go="library"]')).toBeVisible({ timeout: 5_000 });

  // Photos really went to the website while all this ran.
  if (withWeb) await expect.poll(sentToWeb, { timeout: 60_000 }).toBeGreaterThan(0);
  const long = (await win.evaluate("window.__long")) as number[];
  const slowest = clicks.reduce((a, b) => (b.ms > a.ms ? b : a));
  const report = {
    clicks: clicks.length,
    slowestClick: slowest,
    medianClick: clicks.map((c) => c.ms).sort((a, b) => a - b)[Math.floor(clicks.length / 2)],
    slowestAnswer: Math.max(...answers),
    longestFreeze: Math.round(Math.max(0, ...long)),
    sending: withWeb,
    sentToWeb: withWeb ? await sentToWeb() : null,
  };
  console.log("nothing-hangs", JSON.stringify(report));
  writeFileSync(test.info().outputPath("timings.json"), JSON.stringify({ report, clicks, answers, long }, null, 1));
  await app.close();

  // A click shows its tab within 2 seconds even on a slow test machine, the
  // app answers within 2 seconds, and the window never freezes for 1.5 s.
  expect(slowest.ms).toBeLessThan(2000);
  expect(report.slowestAnswer).toBeLessThan(2000);
  expect(report.longestFreeze).toBeLessThan(1500);
  expect(errors).toEqual([]);
});
