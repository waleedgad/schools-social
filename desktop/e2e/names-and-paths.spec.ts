import { _electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Windows readiness (quality plan, Phase 4), checked on Mac, Windows and
// Linux: real school folders have Arabic names, spaces, brackets, emoji and
// can be very deep (Windows used to stop at 260 letters in a path). Every
// photo must be found, get its small copy, and move to an Arabic-named event
// with its name unchanged.
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown }> } };

test("Arabic names, spaces, emoji and very deep folders", async () => {
  test.setTimeout(180_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-names-"));
  const lib = path.join(base, "صور المدرسة Photos");
  const ev = path.join(lib, "2025-2026", "الفصل الأول", "2025-10-12 اليوم الرياضي");
  // Deep enough that the whole path of the last photo is well over 260 letters.
  const deep = path.join(ev, ...Array.from({ length: 6 }, (_, i) => `مجلد فرعي طويل جدا رقم ${i + 1} long sub folder`));
  mkdirSync(deep, { recursive: true });
  const names = ["صورة الطابور.jpg", "IMG 0001 (copy).jpg", "🎉 party #2.JPG", "Grade 5 & 6 — sports.jpeg", "it's done.jpg"];
  const img = (seed: number) => sharp({ create: { width: 320, height: 240, channels: 3, background: { r: (seed * 60) % 255, g: 120, b: 200 } } }).jpeg().toBuffer();
  for (let i = 0; i < names.length; i++) writeFileSync(path.join(ev, names[i]), await img(i));
  const deepName = "صورة في مجلد عميق.jpg";
  writeFileSync(path.join(deep, deepName), await img(9));
  expect(path.join(deep, deepName).length).toBeGreaterThan(260);

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "ar", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  await win.locator('button.nav[data-go="library"]').click();
  const total = names.length + 1;
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(total);
  const found = (await win.evaluate("lib.list.map((p) => p.name)")) as string[];
  expect(found.sort()).toEqual([...names, deepName].sort());
  // Every photo gets its small copy (the image engine can open every path).
  await expect
    .poll(() => win.evaluate("Promise.all(lib.list.map((p) => window.hub.call('photo', p.id))).then((r) => r.filter((x) => (x.value ?? x)?.thumb === 1).length)"), { timeout: 90_000 })
    .toBe(total);
  // The event's Arabic name is read from the folder.
  expect(await win.evaluate("lib.list.filter((p) => p.event_title === 'اليوم الرياضي').length")).toBe(total);

  // Move them all to a new event with an Arabic name.
  const ids = (await win.evaluate("lib.list.map((p) => p.id)")) as number[];
  const moved = await win.evaluate((x) => (window as unknown as Hub).hub.call("moveTo", x, { title: "حفل التخرج", date: "2026-06-20" }), ids);
  expect(moved).toMatchObject({ ok: true });
  const findDir = (dir: string, ending: string): string | null => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name.endsWith(ending)) return p;
      const d = findDir(p, ending);
      if (d) return d;
    }
    return null;
  };
  await expect.poll(() => findDir(lib, "حفل التخرج"), { timeout: 20_000 }).not.toBeNull();
  const target = findDir(lib, "حفل التخرج")!;
  await expect.poll(() => readdirSync(target).filter((f) => !f.startsWith(".")).sort(), { timeout: 20_000 }).toEqual([...names, deepName].sort());
  for (const n of names) expect(existsSync(path.join(ev, n))).toBe(false);
  await win.waitForTimeout(3000);
  expect(await win.evaluate("lib.list.length")).toBe(total);
  await app.close();
});
