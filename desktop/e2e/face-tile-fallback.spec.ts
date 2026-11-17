import { _electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// B-96 (16 Nov 2026): in Faces > "Is this …?" the face being asked about was
// sometimes a blank white square, and in the photo beside it the face was
// marked only by a thin box. Each check fails on the code before the fix.
//   - the original can't be reached (a drive unplugged) and its big copy was
//     never made: the photo beside still showed (small copy), the face didn't
//   - no picture at all can be made: a plain figure, not a blank square
//   - the photo was read again and the face is gone: the question is skipped
//   - the face in the photo: the rest is dimmed and the face has a thick ring
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };

async function img(seed: number) {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: (seed * 53) % 200, g: (seed * 97) % 200, b: (seed * 29) % 200 } } })
    .composite([{ input: Buffer.from(`<svg width="3000" height="2000"><circle cx="${400 + seed * 500}" cy="1000" r="90" fill="white"/></svg>`), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
}

test("Is this …?: the face is never a blank square and is easy to find in the photo", async () => {
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-tile-"));
  const lib = path.join(base, "Photos");
  const folder = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day", "5A");
  mkdirSync(folder, { recursive: true });
  for (let i = 0; i < 4; i++) writeFileSync(path.join(folder, `IMG_${1000 + i}.jpg`), await img(i + 1));

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "ar", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
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
    await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 90_000 }).toBe(4);
    await call("addStudent", { id: "SARA", name_en: "Sara", name_ar: "سارة", class_name: "5A" });

    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(userData, "library.db"));
    db.exec("pragma busy_timeout = 5000");
    const photos = db.prepare("select id, path from photos order by path").all() as { id: number; path: string }[];
    const add = db.prepare("insert into faces (photo_id, x, y, w, h, score, status, suggest_id, suggest_score) values (?, ?, 0.455, 0.06, 0.09, 0.95, 'suggested', 'SARA', ?)");
    // Asked in this order (most likely first). A small face, as in a class photo.
    const faces = photos.map((p, i) => Number(add.run(p.id, (400 + (i + 1) * 500 - 90) / 3000, 0.9 - i * 0.05).lastInsertRowid));
    const cache = (kind: string, id: number) => path.join(userData, "cache", kind, `${id}.jpg`);
    await expect.poll(() => photos.every((p) => existsSync(cache("thumbs", p.id))), { timeout: 60_000 }).toBe(true);

    await expect.poll(() => win.evaluate("S.counts.students"), { timeout: 30_000 }).toBe(1);
    await win.locator('button.nav[data-go="faces"]').click();
    await win.locator('[data-tab="review"]').click();
    const tile = win.locator(".zoomconfirm .q");
    const shown = () => tile.evaluate((el) => (el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : false));
    await expect(win.locator(".zoomconfirm h2")).toContainText("سارة");
    await expect.poll(shown, { timeout: 30_000 }).toBe(true);

    // The marker: a thick ring, the rest of the photo dimmed; and it sits on
    // the face whatever the direction of the page (Arabic here).
    await expect(win.locator(".boxphoto img")).toBeVisible();
    const mark = await win.locator(".zoomconfirm .fbox.on").evaluate((el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect(), p = el.parentElement!.getBoundingClientRect();
      return { border: parseFloat(cs.borderTopWidth), shadow: cs.boxShadow, cx: (r.left + r.width / 2 - p.left) / p.width, dir: getComputedStyle(document.documentElement).direction };
    });
    expect(mark.dir).toBe("rtl");
    expect(mark.border, "B-96: a thick ring, not a thin box").toBeGreaterThanOrEqual(4);
    expect(mark.shadow, "B-96: the rest of the photo is dimmed").toContain("9999px");
    expect(Math.abs(mark.cx - 900 / 3000), "the ring is on the face").toBeLessThan(0.01);

    // While the questions are on screen: the drive with photo 2 is unplugged
    // (its big copy was never made), photo 3 has no copy at all left, and
    // photo 4 was read again so its face is gone.
    // The next faces' pictures are cut ahead of time; wait for that to finish
    // so it can't race the unplugging below.
    const faceDir = path.join(userData, "cache", "faces");
    const cut = (id: number) => existsSync(faceDir) && readdirSync(faceDir).some((n) => n.startsWith(`${id}-`));
    await expect.poll(() => cut(faces[1]) && cut(faces[2]), { timeout: 30_000 }).toBe(true);
    // Photo 2's picture is thrown away too: it must be cut again from the small copy.
    for (const n of readdirSync(faceDir)) if (n.startsWith(`${faces[1]}-`)) rmSync(path.join(faceDir, n));
    rmSync(cache("previews", photos[1].id), { force: true });
    rmSync(photos[1].path);
    for (const kind of ["previews", "thumbs"]) rmSync(cache(kind, photos[2].id), { force: true });
    for (const n of readdirSync(faceDir)) if (n.startsWith(`${faces[2]}-`)) rmSync(path.join(faceDir, n));
    rmSync(photos[2].path);
    db.prepare("delete from faces where id = ?").run(faces[3]);

    await win.keyboard.press("s");
    await expect(win.locator(".boxphoto img")).toBeVisible();
    await expect.poll(async () => (await tile.count()) === 1 && (await shown()), { timeout: 30_000, message: "B-96: the face shows (from the small copy) when the original can't be reached" }).toBe(true);

    await win.keyboard.press("s");
    // The window may still hold the picture it cut ahead of time (then the
    // face shows); otherwise a plain figure. Never a blank square.
    await expect
      .poll(() => win.evaluate(() => {
        const q = document.querySelector(".zoomconfirm .q");
        if (q instanceof HTMLImageElement) return q.complete && q.naturalWidth > 0 ? "face" : "waiting";
        return q?.classList.contains("nopic") && q.querySelector("svg") ? "figure" : "blank";
      }), { timeout: 30_000, message: "B-96: the face or a plain figure, never a blank square" })
      .toMatch(/^(face|figure)$/);
    await expect(win.locator(".zoomconfirm .fbox"), "no ring on an empty frame").toHaveCount(0);
    const grey = await win.locator(".zoomconfirm .q").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(grey).not.toBe("rgba(0, 0, 0, 0)");

    await win.keyboard.press("s");
    await expect(win.locator("#fc-people"), "B-96: a face that is gone is not asked about").toBeVisible({ timeout: 30_000 });
    db.close();
  } finally {
    await app.close();
  }
});
