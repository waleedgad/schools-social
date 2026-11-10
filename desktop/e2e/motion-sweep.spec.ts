import { _electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Exploratory: records every tab while it opens, sits still, and while new
// photos arrive, and prints what moved. Run with MOTION_SWEEP=1.
test.skip(!process.env.MOTION_SWEEP, "exploratory sweep");
const root = path.join(__dirname, "..");
const RECORDER = readFileSync(path.join(root, "..", "e2e", "motion-recorder.js"), "utf8");
const TABS = ["today", "library", "import", "faces", "students", "coverage", "cleanup", "books", "posts", "calendar", "history", "settings", "help"];

async function photo(seed: number) {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: (seed * 37) % 255, g: (seed * 91) % 255, b: (seed * 53) % 255 } } })
    .composite([{ input: Buffer.from(`<svg width="800" height="600"><circle cx="${(seed * 47) % 800}" cy="300" r="120" fill="white"/></svg>`), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
}

const take = (win: Page) => win.evaluate(() => (window as unknown as { __motion: { take: () => unknown[] } }).__motion.take());

for (const [language, theme] of [["en", "light"], ["ar", "dark"]] as const) {
  test(`sweep ${language} ${theme}`, async () => {
    test.setTimeout(900_000);
    const base = mkdtempSync(path.join(tmpdir(), "hub-motion-"));
    const lib = path.join(base, "Photos");
    let n = 0;
    for (const ev of ["2026-10-12 Sports day", "2026-10-20 Book week", "2026-09-30 Art show"])
      for (let i = 0; i < 20; i++) {
        const dir = path.join(lib, "2026-2027", "Term 1", ev);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `IMG_${String(i).padStart(4, "0")}.jpg`), await photo(++n));
      }
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language, theme, setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
    const start = () => _electron.launch({
      executablePath: require("electron") as unknown as string,
      args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
      env: { ...process.env, HUB_TEST: "1" },
    });
    let app = await start();
    let win = await app.firstWindow();
    await win.locator('button.nav[data-go="library"]').click();
    await expect.poll(() => win.evaluate("lib.list.filter((p) => p.thumb === 1).length"), { timeout: 120_000 }).toBe(60);
    await win.waitForTimeout(2000);
    await app.close();
    // Students in three classes, named in the photos, some suggestions.
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(userData, "library.db"));
    const addStudent = db.prepare("insert into students (id, name_en, class_name, can_post, added_at) values (?, ?, ?, 1, 0)");
    for (let i = 0; i < 30; i++) addStudent.run(`S${i}`, `Student ${i}`, ["3A", "3B", "4A"][i % 3]);
    const addFace = db.prepare("insert into faces (photo_id, x, y, w, h, student_id, status, suggest_id, suggest_score) values (?, ?, 0.3, 0.2, 0.25, ?, ?, ?, 0.6)");
    const ids = (db.prepare("select id from photos").all() as { id: number }[]).map((r) => r.id);
    ids.forEach((id, k) => {
      addFace.run(id, 0.1, `S${k % 30}`, "confirmed", null);
      if (k % 3 === 0) addFace.run(id, 0.6, null, "suggested", `S${(k + 7) % 30}`);
      if (k % 5 === 0) addFace.run(id, 0.4, null, "new", null);
      db.prepare("update photos set face_count = ?, faces_scanned = 1 where id = ?").run(1 + (k % 3 === 0 ? 1 : 0) + (k % 5 === 0 ? 1 : 0), id);
    });
    db.close();
    app = await start();
    win = await app.firstWindow();
    await expect(win.locator("#side .nav").first()).toBeVisible({ timeout: 30_000 });
    await win.evaluate(RECORDER);
    await win.waitForTimeout(4000);
    await take(win);
    const report: Record<string, unknown> = {};
    try {
    let extra = 0;
    for (const tab of TABS) {
      await win.locator(`button.nav[data-go="${tab}"]`).click();
      await win.waitForTimeout(2500);
      report[`${tab} open`] = await take(win);
      await win.mouse.move(5, 5);
      await win.waitForTimeout(3000);
      report[`${tab} idle`] = await take(win);
      // Scroll the biggest box down, then new photos arrive.
      await win.evaluate(() => {
        const box = [...document.querySelectorAll("#main *")].filter((e) => e.scrollHeight - e.clientHeight > 100 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (box) box.scrollTop = 300;
      });
      await win.waitForTimeout(300);
      await take(win);
      const dir = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day");
      for (let i = 0; i < 2; i++) writeFileSync(path.join(dir, `NEW_${extra++}.jpg`), await photo(500 + extra));
      await win.waitForTimeout(6000);
      report[`${tab} update`] = await take(win);
      // Click around inside the tab: pills, tiles, rows.
      const clickable = await win.locator("#main .pill:visible, #main .tile:visible, #main tr.click:visible, #main .person:visible, #main .tree .t:visible, #main .setnav .nav:visible").all();
      for (const c of clickable.slice(0, 6)) {
        await c.click({ timeout: 2000 }).catch(() => {});
        await win.waitForTimeout(700);
        await win.keyboard.press("Escape");
      }
      await win.waitForTimeout(800);
      report[`${tab} clicks`] = await take(win);
    }
    // Library: select, star, flag, move with keys; viewer; sizes.
    await win.evaluate(`lib.filter = { album: "all" }; go("library")`);
    await win.waitForTimeout(1500);
    await take(win);
    await win.locator("#grid .tile").nth(2).click();
    for (const k of ["ArrowRight", "ArrowRight", "3", "p", "ArrowDown", "x", "ArrowLeft"]) {
      await win.keyboard.press(k);
      await win.waitForTimeout(250);
    }
    await win.waitForTimeout(1500);
    report["library keys"] = await take(win);
    await win.locator("#grid .tile").nth(4).dblclick();
    await win.waitForTimeout(1200);
    for (const k of ["ArrowRight", "ArrowRight", "p", "3", "ArrowLeft", "f", "b", "b"]) {
      await win.keyboard.press(k);
      await win.waitForTimeout(400);
    }
    report["viewer"] = await take(win);
    await win.keyboard.press("Escape");
    await win.waitForTimeout(1200);
    report["viewer close"] = await take(win);
    await win.keyboard.press("Meta+k").catch(() => {});
    await win.keyboard.press("Control+k").catch(() => {});
    await win.waitForTimeout(600);
    await win.keyboard.type("sett", { delay: 80 });
    await win.waitForTimeout(800);
    await win.keyboard.press("Escape");
    report["palette"] = await take(win);
    // Window resized smaller and back.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700));
    await win.waitForTimeout(1200);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
    await win.waitForTimeout(1200);
    report["resize"] = await take(win);
    } finally {
    const summary: string[] = [];
    for (const [k, evs] of Object.entries(report) as [string, { kind: string; [x: string]: unknown }[]][]) {
      const by = new Map<string, number>();
      for (const e of evs) {
        const key = `${e.kind} ${e.name ?? ""} ${e.el ?? (e.els as string[] | undefined)?.join(",") ?? ""} ${e.kind === "long" ? e.ms + "ms " + (e.scripts as string[]).join(",") : ""} ${e.kind === "shift" ? e.value : ""}${e.kind === "scrollreset" ? `${e.from}->${e.to}` : ""}`;
        by.set(key, (by.get(key) ?? 0) + 1);
      }
      if (by.size) summary.push(`## ${k}\n` + [...by].map(([x, c]) => `  ${c}x ${x}`).join("\n"));
    }
    writeFileSync(path.join(tmpdir(), `motion-${language}-${theme}.txt`), summary.join("\n"));
    console.log(summary.join("\n"));
    await app.close();
    }
  });
}
