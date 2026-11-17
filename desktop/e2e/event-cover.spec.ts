import { _electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Albums: an event's card showed the event's first photo, even when that
// file can't be read (a half-copied or damaged file, a format this computer
// can't open). The card was then an empty picture although the event is
// full of good photos. Fails on the code before the fix.
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };

test("an event's card never shows a photo that can't be read", async () => {
  test.setTimeout(240_000);
  const lib = path.join(mkdtempSync(path.join(tmpdir(), "hub-cover-")), "Photos");
  const dir = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day");
  const broken = path.join(lib, "2026-2027", "Term 1", "2026-10-20 Broken card");
  mkdirSync(dir, { recursive: true });
  mkdirSync(broken, { recursive: true });
  // The first file of the event is damaged; the rest are fine.
  writeFileSync(path.join(dir, "IMG_1000.jpg"), Buffer.from("not a picture at all"));
  for (let i = 1; i < 4; i++) writeFileSync(path.join(dir, `IMG_${1000 + i}.jpg`), await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: i * 60, g: 90, b: 160 } } }).jpeg().toBuffer());
  // An event where nothing can be read: a plain folder card, not an empty picture.
  writeFileSync(path.join(broken, "IMG_2000.jpg"), Buffer.from("not a picture either"));

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  try {
    const win = await app.firstWindow();
    const call = async <T = unknown>(f: string, ...a: unknown[]) => {
      const r = await win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
      expect(r.ok, `${f}: ${JSON.stringify(r)}`).toBe(true);
      return r.value as T;
    };
    await win.locator('button.nav[data-go="library"]').click();
    await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 90_000 }).toBe(5);
    // Every photo has been looked at: three are fine, two can't be read.
    const states = () => win.evaluate("Promise.all(lib.list.map((p) => window.hub.call('photo', p.id))).then((r) => r.map((x) => (x.value ?? x)?.thumb).sort().join())");
    await expect.poll(states, { timeout: 120_000 }).toBe("-1,-1,1,1,1");

    type Row = { event_title: string; cover: number | null };
    const rows = (await call<{ rows: Row[] }>("tree")).rows;
    const cover = rows.find((r) => r.event_title === "Sports day")!.cover!;
    expect((await call<{ thumb: number; name: string }>("photo", cover)).thumb, "the card shows a photo that can be read").toBe(1);
    expect(rows.find((r) => r.event_title === "Broken card")!.cover).toBeNull();

    await win.locator('#tree [data-album="albums"]').click();
    const card = win.locator("#grid .zcard", { hasText: "Sports day" });
    await expect.poll(() => card.locator("img").evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 30_000 }).toBe(true);
    const none = win.locator("#grid .zcard", { hasText: "Broken card" });
    await expect(none).toBeVisible();
    await expect(none.locator("img")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
