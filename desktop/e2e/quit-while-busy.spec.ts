import { _electron, expect, test, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Tricky bugs hunt (16 Nov 2026): quitting while the app is busy. The app is
// closed in the middle of an import, while it is still reading photos and
// looking for faces. It must close quickly, report no error, and on the next
// start finish the import with every photo once, leave no half-copied files,
// and open an undamaged library.
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };

async function photos(dir: string, n: number, seed: number) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const s = seed + i;
    const img = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: (s * 37) % 255, g: (s * 91) % 255, b: (s * 53) % 255 } } })
      .composite([{ input: Buffer.from(`<svg width="1600" height="1200"><rect x="${(s * 47) % 1500}" y="40" width="90" height="1100" fill="white"/><circle cx="800" cy="400" r="150" fill="#e0b090"/></svg>`), top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer();
    writeFileSync(path.join(dir, `IMG_${String(s).padStart(5, "0")}.jpg`), img);
  }
}

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

async function launch(userData: string, log: string[]) {
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  app.process().stderr?.on("data", (d) => log.push(String(d)));
  app.process().stdout?.on("data", (d) => log.push(String(d)));
  const win = await app.firstWindow();
  const call = (f: string, ...a: unknown[]) => win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
  return { app, win, call };
}

// Quits the way the menu does, and waits for the app to be gone.
async function quit(app: ElectronApplication) {
  const proc = app.process();
  const gone = new Promise<{ code: number | null; ms: number }>((resolve) => {
    const t0 = Date.now();
    proc.once("exit", (code) => resolve({ code, ms: Date.now() - t0 }));
  });
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  return gone;
}

test("quitting in the middle of an import, photo reading and face search", async () => {
  test.setTimeout(420_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-quit-"));
  const lib = path.join(base, "Photos");
  await photos(path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day"), 40, 0);
  const card = path.join(base, "Card", "DCIM");
  await photos(card, 150, 1000);

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: true, faceVision: false }));
  const log: string[] = [];
  const first = await launch(userData, log);

  await first.win.locator('button.nav[data-go="import"]').click();
  await first.win.evaluate((dir) => (window as unknown as { go: (v: string, p: object) => void }).go("import", { sources: [dir] }), card);
  await expect(first.win.locator("#i-go")).toBeEnabled({ timeout: 120_000 });
  const title = first.win.locator('[data-ev][data-f="title"]').first();
  if (!(await title.inputValue()).trim()) await title.fill("Book week");
  await first.win.locator("#i-go").click();
  // Wait until some photos are in, but not all.
  await expect
    .poll(async () => walk(lib).filter((f) => f.includes("Book week") && f.endsWith(".jpg")).length, { timeout: 120_000, intervals: [100] })
    .toBeGreaterThan(5);
  const st = (await first.call("state")).value as { engine?: { processing?: number; faceQueue?: number } };
  console.log("quit-while-busy at quit", JSON.stringify({ copied: walk(lib).filter((f) => f.includes("Book week")).length, engine: st.engine }));

  const ended = await quit(first.app);
  writeFileSync(test.info().outputPath("app-output-1.txt"), log.join(""));
  console.log("quit-while-busy closed", JSON.stringify(ended));
  // Closes on its own within 15 seconds, without crashing.
  expect(ended.ms).toBeLessThan(15_000);
  expect(ended.code).toBe(0);

  // Next start: the import finishes, every photo once, nothing half copied.
  const again = await launch(userData, log);
  await expect
    .poll(async () => ((await again.call("importJobs")).value as { state: string }[]).filter((j) => j.state === "running" || j.state === "waiting").length, { timeout: 180_000 })
    .toBe(0);
  const files = walk(lib);
  const imported = files.filter((f) => !path.basename(f).startsWith(".") && /IMG_01\d{3}/.test(path.basename(f)));
  expect(files.filter((f) => f.endsWith(".copying")), "no half-copied files left").toEqual([]);
  expect(imported.filter((f) => / \(\d+\)\.jpg$/.test(f)), "no photo copied twice").toEqual([]);
  expect(imported.length).toBe(150);
  // The library database is undamaged and holds every photo.
  await again.win.locator('button.nav[data-go="library"]').click();
  await expect.poll(async () => (await again.win.evaluate("lib.list.length")) as number, { timeout: 120_000 }).toBe(190);
  const ended2 = await quit(again.app);
  writeFileSync(test.info().outputPath("app-output-2.txt"), log.join(""));
  expect(ended2.code).toBe(0);

  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  expect((db.prepare("pragma integrity_check").get() as Record<string, string>).integrity_check).toBe("ok");
  db.close();
  const errors = existsSync(path.join(userData, "errors.json")) ? (JSON.parse(readFileSync(path.join(userData, "errors.json"), "utf8")) as { message: string }[]) : [];
  expect(errors.map((e) => e.message)).toEqual([]);
});
