import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// How the app LOOKS while things change, not only whether it works (B-67, B-69 to
// B-76). A recorder in the window (e2e/motion-recorder.js, shared with the
// website tests) notes every animation that starts, every picture that is
// thrown away and drawn again, layout jumps, blank frames, lists thrown back
// to the top and typing fields taken away. Each test does what a person does
// and checks that only what really changed moved.
const root = path.join(__dirname, "..");
const RECORDER = readFileSync(path.join(root, "..", "e2e", "motion-recorder.js"), "utf8");
const TABS = ["today", "library", "import", "faces", "students", "coverage", "cleanup", "books", "posts", "calendar", "history", "settings", "help"];
type Ev = { kind: string; name?: string; el?: string; els?: string[]; value?: number; from?: number; to?: number; ms?: number };

async function photo(seed: number) {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: (seed * 37) % 255, g: (seed * 91) % 255, b: (seed * 53) % 255 } } })
    .composite([{ input: Buffer.from(`<svg width="800" height="600"><circle cx="${(seed * 47) % 800}" cy="300" r="120" fill="white"/></svg>`), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
}

const start = (userData: string) =>
  _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });

// A library of 36 photos in three events, 30 students named in them, some
// suggestions and some faces not named yet.
async function school(language: "en" | "ar", theme: "light" | "dark") {
  const base = mkdtempSync(path.join(tmpdir(), "hub-motion-"));
  const lib = path.join(base, "Photos");
  let n = 0;
  for (const ev of ["2026-10-12 Sports day", "2026-10-20 Book week", "2026-09-30 Art show"]) {
    const dir = path.join(lib, "2026-2027", "Term 1", ev);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 12; i++) writeFileSync(path.join(dir, `IMG_${String(i).padStart(4, "0")}.jpg`), await photo(++n));
  }
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language, theme, setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  let app = await start(userData);
  let win = await app.firstWindow();
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.filter((p) => p.thumb === 1).length"), { timeout: 120_000 }).toBe(36);
  await app.close();
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  const addStudent = db.prepare("insert into students (id, name_en, class_name, can_post, added_at) values (?, ?, ?, 1, 0)");
  for (let i = 0; i < 30; i++) addStudent.run(`S${i}`, `Student ${i}`, ["3A", "3B", "4A"][i % 3]);
  const addFace = db.prepare("insert into faces (photo_id, x, y, w, h, student_id, status, suggest_id, suggest_score) values (?, ?, 0.3, 0.2, 0.25, ?, ?, ?, 0.6)");
  const ids = (db.prepare("select id from photos").all() as { id: number }[]).map((r) => r.id);
  ids.forEach((id, k) => {
    addFace.run(id, 0.1, `S${k % 30}`, "confirmed", null);
    if (k % 3 === 0) addFace.run(id, 0.6, null, "suggested", `S${(k + 7) % 30}`);
    db.prepare("update photos set face_count = ?, faces_scanned = 1 where id = ?").run(1 + (k % 3 === 0 ? 1 : 0), id);
  });
  db.close();
  app = await start(userData);
  win = await app.firstWindow();
  await expect(win.locator("#side .nav").first()).toBeVisible({ timeout: 30_000 });
  await win.evaluate(RECORDER);
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  // Let the first thumbnails and face pictures settle.
  await win.waitForTimeout(3000);
  return { app, win, lib, errors };
}

const take = (win: Page) => win.evaluate(() => (window as unknown as { __motion: { take: () => Ev[] } }).__motion.take());
const show = (evs: Ev[]) => evs.map((e) => `${e.kind} ${e.name ?? ""} ${e.el ?? e.els?.join(",") ?? ""}${e.kind === "shift" ? ` ${e.value}` : ""}${/scroll/.test(e.kind) ? ` ${e.from}->${e.to}` : ""}`.trim());
// Loading placeholders shimmer on purpose; everything else must stay still.
const moved = (evs: Ev[]) => show(evs.filter((e) => !(e.kind === "anim" && e.name === "shimmer") && e.kind !== "long"));
async function scrollMain(win: Page, top: number) {
  await win.evaluate((top) => {
    const box = [...document.querySelectorAll("#main *")].filter((e) => e.scrollHeight - e.clientHeight > 100 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (box) box.scrollTop = top;
  }, top);
}

test("the window opens in its own colours and language: no white frame in dark mode (B-76)", async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", theme: "dark", setupDone: true, tourDone: true, wizard: true }));
  const app: ElectronApplication = await start(userData);
  // Every frame from the first one, read straight from the window.
  const frames = await app.evaluate(async ({ BrowserWindow }) => {
    const out: { t: number; main: number; dir: string }[] = [];
    const t0 = Date.now();
    // A slow test machine draws few frames in 2.5 s: keep reading until there are enough.
    while (Date.now() - t0 < 2500 || (out.length < 8 && Date.now() - t0 < 15_000)) {
      const w = BrowserWindow.getAllWindows()[0];
      if (w && !w.webContents.isLoading()) {
        const img = await w.webContents.capturePage();
        if (!img.isEmpty()) {
          const { width, height } = img.getSize();
          const bmp = img.toBitmap();
          const i = (Math.floor(height * 0.5) * width + Math.floor(width * 0.6)) * 4;
          const dir = await w.webContents.executeJavaScript("document.documentElement.dir").catch(() => "?");
          out.push({ t: Date.now() - t0, main: Math.round((bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3), dir });
        }
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return out;
  });
  await app.close();
  expect(frames.length).toBeGreaterThan(5);
  expect(frames.filter((f) => f.main > 120), "light frames in dark mode").toEqual([]);
  expect(frames.filter((f) => f.dir !== "ltr"), "right-to-left frames in English").toEqual([]);
});

for (const [language, theme] of [["en", "light"], ["ar", "dark"]] as const) {
  test(`every tab sits still, and new photos don't redraw what's already there (${language}, ${theme})`, async () => {
    test.setTimeout(420_000);
    const { app, win, lib, errors } = await school(language, theme);
    const problems: string[] = [];
    let extra = 0;
    for (const tab of TABS) {
      await win.locator(`button.nav[data-go="${tab}"]`).click();
      await win.waitForTimeout(2000);
      await take(win);
      // Sitting still: nothing at all may move (B-69: Today's cards played
      // their "appear" animation again every few seconds).
      await win.mouse.move(5, 5);
      await win.waitForTimeout(2500);
      for (const m of moved(await take(win))) problems.push(`${tab}, sitting still: ${m}`);
      // New photos arrive while the list is scrolled down: what was on
      // screen stays (B-70: every thumbnail was drawn again and popped in).
      await scrollMain(win, 300);
      await win.waitForTimeout(300);
      await take(win);
      const dir = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day");
      for (let i = 0; i < 2; i++) writeFileSync(path.join(dir, `NEW_${extra++}.jpg`), await photo(500 + extra));
      await win.waitForTimeout(5000);
      const after = (await take(win)).filter((e) => !(e.kind === "anim" && e.name === "shimmer") && e.kind !== "long");
      // The two new tiles may pop in; nothing else.
      const newTiles = after.filter((e) => e.kind === "anim" && e.name === "pop" && /tile/.test(e.el ?? "")).length;
      if (newTiles > 2) problems.push(`${tab}, new photos: ${newTiles} tiles animated again`);
      // New pictures may load in; old ones must never be thrown away and
      // drawn again, and nothing may jump, go blank or scroll back up.
      for (const m of show(after.filter((e) => !(e.kind === "anim" && e.name === "pop" && /tile/.test(e.el ?? "")) && e.kind !== "popin"))) problems.push(`${tab}, new photos: ${m}`);
    }
    await app.close();
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("the big view, the selection bar, Help, Faces and Students change in place (B-71 to B-75)", async () => {
  test.setTimeout(300_000);
  const { app, win, errors } = await school("en", "light");
  const problems: string[] = [];

  // Library: selecting photos with the keyboard. The bar at the bottom
  // slides in once, then only its numbers change (B-72).
  await win.locator('button.nav[data-go="library"]').click();
  await win.waitForTimeout(2000);
  await win.locator("#grid .tile").nth(2).click();
  await win.waitForTimeout(500);
  await take(win);
  for (const k of ["Shift+ArrowRight", "Shift+ArrowRight", "Shift+ArrowLeft"]) {
    await win.keyboard.press(k);
    await win.waitForTimeout(300);
  }
  for (const m of moved(await take(win))) problems.push(`selecting: ${m}`);

  // The big view: moving between photos keeps the strip of photos, the
  // buttons and the side panel; the picture is ready before it's swapped
  // (B-67, B-71).
  await win.locator("#grid .tile").nth(4).dblclick();
  await win.waitForTimeout(1500);
  await win.evaluate(() => { (document.querySelector("#v-img") as HTMLImageElement & { _first?: boolean })._first = true; });
  await take(win);
  for (const k of ["ArrowRight", "ArrowRight", "ArrowLeft", "p", "3"]) {
    await win.keyboard.press(k);
    await win.waitForTimeout(500);
  }
  // The picture changes inside the same element, so the old one stays on
  // screen until the next is ready (never blank, B-67); a big photo whose
  // preview is still being made may take a moment, that is fine.
  for (const m of moved(await take(win)).filter((m) => !/popin .*#v-img/.test(m))) problems.push(`big view: ${m}`);
  expect(await win.evaluate(() => (document.querySelector("#v-img") as HTMLImageElement & { _first?: boolean })._first), "the big picture was replaced, not changed").toBe(true);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(800);

  // Help: picking another guide keeps the list where it was scrolled and
  // doesn't fade the page in again (B-74).
  await win.locator('button.nav[data-go="help"]').click();
  await win.waitForTimeout(1500);
  const top = await win.evaluate(() => { const t = document.querySelector("#main nav.tree")!; t.scrollTop = t.scrollHeight; return t.scrollTop; });
  expect(top).toBeGreaterThan(50);
  await win.waitForTimeout(300);
  await take(win);
  const guide = win.locator("#main nav.tree .t").last();
  await guide.click();
  await win.waitForTimeout(1200);
  for (const m of moved(await take(win))) problems.push(`help: ${m}`);
  expect(await win.evaluate(() => document.querySelector("#main nav.tree")!.scrollTop)).toBeGreaterThan(top - 5);

  // Students: ticking people keeps every face picture (B-73).
  await win.locator('button.nav[data-go="students"]').click();
  await win.waitForTimeout(2500);
  await take(win);
  const people = win.locator("#st-body [data-id]");
  await people.nth(1).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await win.waitForTimeout(400);
  await people.nth(3).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await win.waitForTimeout(800);
  for (const m of moved(await take(win)).filter((m) => !/selbar/.test(m))) problems.push(`students: ${m}`);
  await win.keyboard.press("Escape");

  // Faces: searching keeps the faces that still match (B-73).
  await win.locator('button.nav[data-go="faces"]').click();
  await win.waitForTimeout(2500);
  await take(win);
  await win.locator("#fc-q").fill("Student 1");
  await win.waitForTimeout(1200);
  const faces = await take(win);
  // (The people left move up, which is what a search does.)
  for (const m of show(faces.filter((e) => e.kind === "reimg" || e.kind === "blank" || e.kind === "focuslost" || /scroll/.test(e.kind)))) problems.push(`faces search: ${m}`);
  await expect(win.locator("#fc-q")).toBeFocused();

  // ⌘K: typing fast, the answer for the last letters wins (B-75).
  await win.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await win.waitForTimeout(400);
  await win.keyboard.type("settin", { delay: 20 });
  await win.waitForTimeout(1500);
  const labels = await win.locator(".palette .res .it").allInnerTexts();
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((l) => /settin/i.test(l)), labels.join(" | ")).toBe(true);
  await win.keyboard.press("Escape");

  await app.close();
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});
