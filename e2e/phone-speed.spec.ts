import { expect, test } from "@playwright/test";
import { newSchool } from "./helpers";

// How fast the pages people use most open on a mid-range phone on mobile
// data: the processor slowed 4 times and a 4G-like connection (9 Mbit/s,
// 150 ms). "Shown" is when the biggest part of the page has appeared
// (Largest Contentful Paint); Google counts under 2.5 s as good.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const PAGES = ["login", "today", "posts", "calendar", "library", "check", "upload", "inbox", "students", "posts/new"];

// Program code a page may download on a first visit (compressed). Set a
// little above today's biggest page so a heavy new library is noticed.
const JS_BUDGET_KB = 300; // about 200 KB on 5 Nov 2026

test("main pages open quickly on a phone", async ({ page, browserName }, info) => {
  test.skip(info.project.name !== "phone" || browserName !== "chromium", "phone only");
  test.setTimeout(180_000);
  await newSchool(page, "speed");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const results: Record<string, { first: number; shown: number; ready: number; jumps: number; jsKB: number }> = {};
  // How much the page jumps around while loading (Cumulative Layout Shift;
  // Google counts under 0.1 as good), and how much program code it downloads.
  const jumps = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((l) => {
            for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) total += e.value;
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(Math.round(total * 1000) / 1000), 1500);
        }),
    );
  const jsKB = () =>
    page.evaluate(() =>
      Math.round(
        (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((r) => r.initiatorType === "script" || r.name.endsWith(".js")).reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024,
      ),
    );
  const lcp = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          new PerformanceObserver((l) => {
            const e = l.getEntries();
            resolve(Math.round(e[e.length - 1].startTime));
          }).observe({ type: "largest-contentful-paint", buffered: true });
          setTimeout(() => resolve(-1), 3000);
        }),
    );
  for (const p of PAGES) {
    // First visit with nothing saved on the phone, then a second visit, as
    // people come back to these pages.
    await cdp.send("Network.clearBrowserCache");
    await page.goto(`/en/${p}`, { waitUntil: "load" });
    const first = await lcp();
    const js = await jsKB();
    const t0 = Date.now();
    await page.goto(`/en/${p}`, { waitUntil: "load" });
    const ready = Date.now() - t0;
    const shown = await lcp();
    results[p] = { first, shown, ready, jumps: await jumps(), jsKB: js };
  }
  console.log("phone-speed", JSON.stringify(results));
  for (const [p, r] of Object.entries(results)) {
    expect(r.first, `${p} first visit shown after ${r.first} ms`).toBeLessThan(4000);
    expect(r.shown, `${p} shown after ${r.shown} ms`).toBeLessThan(2500);
    expect(r.jumps, `${p} jumps around while loading (${r.jumps})`).toBeLessThan(0.1);
    expect(r.jsKB, `${p} downloads ${r.jsKB} KB of program code`).toBeLessThan(JS_BUDGET_KB);
  }
});
