import { _electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// A book with a photo that exists only as a camera RAW file (or an iPhone
// HEIC): printing read the original without the reader every other screen
// uses, so the book could not be saved as a PDF at all. Fails on the code
// before the fix.
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };
type Book = { id: number; pages: { type: string; photos: number[] }[] };

// A camera RAW file carries a full-size JPEG preview; the app reads that.
const rawFile = (jpeg: Buffer) => Buffer.concat([Buffer.from("II*\u0000fake camera raw for the robot test\u0000"), jpeg]);

test("a book with RAW-only photos is saved as a PDF with every picture in it", async () => {
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-bookraw-"));
  const lib = path.join(base, "Photos");
  const out = path.join(base, "out");
  mkdirSync(out);
  const dir = path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(dir, { recursive: true });
  const n = 4;
  // Sharp enough to go in a book: a checkerboard in the middle of each photo.
  const checker = Buffer.from(
    `<svg width="2400" height="1800"><defs><pattern id="c" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#000"/><rect x="20" y="20" width="20" height="20" fill="#000"/><rect x="20" width="20" height="20" fill="#fff"/><rect y="20" width="20" height="20" fill="#fff"/></pattern></defs><rect x="600" y="400" width="1200" height="1000" fill="url(#c)"/></svg>`,
  );
  for (let i = 0; i < n; i++) {
    const jpeg = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: (i * 60) % 255, g: 120, b: 160 } } }).composite([{ input: checker, top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
    writeFileSync(path.join(dir, `IMG_${1000 + i}.CR2`), rawFile(jpeg));
  }

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false, schoolName: "Book Test School" }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1", HUB_TEST_DIR: out },
  });
  try {
    const win = await app.firstWindow();
    const call = async <T = unknown>(f: string, ...a: unknown[]) => {
      const r = await win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
      expect(r.ok, `${f}: ${JSON.stringify(r)}`).toBe(true);
      return r.value as T;
    };
    await win.locator('button.nav[data-go="library"]').click();
    await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 90_000 }).toBe(n);
    await expect
      .poll(() => win.evaluate("Promise.all(lib.list.map((p) => window.hub.call('photo', p.id))).then((r) => r.filter((x) => (x.value ?? x)?.thumb === 1).length)"), { timeout: 120_000 })
      .toBe(n);

    const id = await call<number>("newBook", { kind: "grade", year: "2025-2026", grade: "Grade 12" });
    const used = [...new Set((await call<Book>("book", id)).pages.flatMap((p) => p.photos))];
    expect(used.length, "the RAW photos are in the book").toBeGreaterThan(0);
    // Before: "Input file contains unsupported image format", and no PDF.
    const pdf = await call<{ file: string; missing: number }>("bookPdf", id);
    expect(pdf.missing).toBe(0);
    expect(existsSync(pdf.file)).toBe(true);
    // Printed from the camera's full-size picture.
    for (const photo of used) expect((await sharp(path.join(userData, "cache", "book", `${photo}.jpg`)).metadata()).width).toBe(2400);
  } finally {
    await app.close();
  }
});
