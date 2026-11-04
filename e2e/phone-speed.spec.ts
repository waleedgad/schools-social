import { expect, test } from "@playwright/test";
import { newSchool } from "./helpers";

// How fast the pages people use most open on a mid-range phone on mobile
// data: the processor slowed 4 times and a 4G-like connection (9 Mbit/s,
// 150 ms). "Shown" is when the biggest part of the page has appeared
// (Largest Contentful Paint); Google counts under 2.5 s as good.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");

const PAGES = ["login", "today", "posts", "calendar", "library", "check", "upload"];

test("main pages open quickly on a phone", async ({ page, browserName }, info) => {
  test.skip(info.project.name !== "phone" || browserName !== "chromium", "phone only");
  test.setTimeout(180_000);
  await newSchool(page, "speed");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const results: Record<string, { first: number; shown: number; ready: number }> = {};
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
    const t0 = Date.now();
    await page.goto(`/en/${p}`, { waitUntil: "load" });
    const ready = Date.now() - t0;
    const shown = await lcp();
    results[p] = { first, shown, ready };
  }
  console.log("phone-speed", JSON.stringify(results));
  for (const [p, r] of Object.entries(results)) {
    expect(r.first, `${p} first visit shown after ${r.first} ms`).toBeLessThan(4000);
    expect(r.shown, `${p} shown after ${r.shown} ms`).toBeLessThan(2500);
  }
});
