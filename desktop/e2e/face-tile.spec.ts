import { _electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// B-96: Faces > "Is this ...?" shows the face being asked about in its tile
// (never a blank white square), the next faces' pictures are cut ahead of
// time, and the face is marked clearly in the photo (white ring, the rest of
// the photo dimmed), whatever the accent colour is.
const root = path.join(__dirname, "..");

test("B-96: the face tile shows the face, the next ones are ready, the face is clearly marked", async () => {
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-tile-"));
  const lib = path.join(base, "Photos");
  const dir = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day", "10A");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 6; i++) {
    const photo = await sharp({ create: { width: 4000, height: 2667, channels: 3, background: { r: 60 + i * 20, g: 120, b: 90 } } })
      .composite([{ input: Buffer.from(`<svg width="4000" height="2667"><circle cx="3300" cy="700" r="50" fill="#f2d3b3"/><circle cx="900" cy="1500" r="120" fill="#e0b48f"/></svg>`) }])
      .jpeg().toBuffer();
    writeFileSync(path.join(dir, `IMG_${1000 + i}.jpg`), photo);
  }
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  // A black accent: a dark outline would vanish on a dark photo.
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false, accent: "#000000" }));
  const app = await _electron.launch({ executablePath: require("electron") as unknown as string, args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])], env: { ...process.env, HUB_TEST: "1" } });
  try {
    const win = await app.firstWindow();
    await win.locator('button.nav[data-go="library"]').click();
    await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 90_000 }).toBe(6);
    await expect.poll(async () => ((await win.evaluate("window.hub.call('state')")) as { value: { engine?: { processing?: number } } }).value.engine?.processing ?? 0, { timeout: 90_000 }).toBe(0);
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(userData, "library.db"));
    db.exec("pragma busy_timeout = 5000");
    db.prepare("insert into students (id, name_en, class_name, can_post, kind, added_at) values ('S1', 'Sara Hassan', '10A', 1, 'student', 1)").run();
    const photos = db.prepare("select id from photos order by path").all() as { id: number }[];
    const ins = db.prepare("insert into faces (photo_id, x, y, w, h, score, status, suggest_id, suggest_score) values (?, ?, ?, ?, ?, 0.95, 'suggested', 'S1', 0.65)");
    const faceIds = photos.map((p) => Number(ins.run(p.id, 0.8, 0.22, 0.03, 0.04).lastInsertRowid));
    db.close();

    // The app picks up the new rows on its next 3-second refresh (slower on a
    // busy test machine): wait until it knows the student.
    await expect.poll(() => win.evaluate("S.counts.students"), { timeout: 30_000 }).toBe(1);
    await win.locator('button.nav[data-go="faces"]').click();
    await win.locator('[data-tab="review"]').click();
    const tile = win.locator(".zoomconfirm .q");
    await expect(tile).toBeVisible({ timeout: 30_000 });
    // The face picture is really there (not a broken, blank square).
    await expect.poll(() => tile.evaluate((im) => (im as HTMLImageElement).complete && (im as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(50);

    // The next faces' pictures are already cut before this one is answered.
    // Face pictures are named by face number, photo and box (B-96).
    const faceDir = path.join(userData, "cache", "faces");
    const cached = (id: number) => existsSync(faceDir) && readdirSync(faceDir).some((n) => n.startsWith(`${id}-`));
    const shown = await win.evaluate("1");
    expect(shown).toBe(1);
    await expect.poll(() => faceIds.filter(cached).length, { timeout: 20_000, message: "the next face pictures are made ahead" }).toBeGreaterThanOrEqual(5);

    // The face in the photo: a white ring, the rest dimmed, even with a black accent.
    const style = await win.locator(".boxphoto .fbox.on").evaluate((el) => {
      const c = getComputedStyle(el);
      return { outline: c.outlineColor, outlineW: c.outlineWidth, shadow: c.boxShadow, border: c.borderTopColor };
    });
    expect(style.outline).toBe("rgb(255, 255, 255)");
    expect(parseFloat(style.outlineW)).toBeGreaterThanOrEqual(3);
    expect(style.shadow).toContain("9999px");
    expect(style.border).toBe("rgb(255, 255, 255)");
    await win.screenshot({ path: test.info().outputPath("is-this.png") });
  } finally {
    await app.close();
  }
});
