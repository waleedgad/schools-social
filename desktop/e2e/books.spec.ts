import { _electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Yearbooks and graduation books, start to finish (release 0.6): a grade
// yearbook, a graduation book over two school years, a book for every
// student in a class, and a flipbook. Checks that every page is printed at
// the right size with no empty picture frames, that a student who can't
// appear is left out (or blurred when the book says so) and never shows up
// with a face on a class page, and that locked pages and versions survive a
// new draft.
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };
type Page = { id: string; type: string; title: string; titleAr?: string; photos: number[]; students?: string[]; className?: string | null; year?: string | null; locked?: boolean };
type Book = { id: number; spec: Record<string, unknown>; pages: Page[]; versions: { i: number; label: string }[] };

// Pages and the first page's size (points) of a PDF made by Chromium.
function pdfInfo(file: string) {
  const text = readFileSync(file).toString("latin1");
  const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(text);
  return { pages, w: Number(box?.[1]), h: Number(box?.[2]) };
}
const pt = (mm: number) => (mm / 25.4) * 72;

test("yearbooks, graduation books, student books and flipbooks", async () => {
  test.setTimeout(300_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-books-"));
  const lib = path.join(base, "Photos");
  const out = path.join(base, "out");
  mkdirSync(out);
  // Big enough for print (no "low resolution" warning), each a different colour.
  // The middle of each photo is a black-and-white checkerboard, so a blur shows.
  const checker = Buffer.from(
    `<svg width="2400" height="1800"><defs><pattern id="c" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#000"/><rect x="20" y="20" width="20" height="20" fill="#000"/><rect x="20" width="20" height="20" fill="#fff"/><rect y="20" width="20" height="20" fill="#fff"/></pattern></defs><rect x="960" y="540" width="480" height="486" fill="url(#c)"/></svg>`,
  );
  const img = (seed: number) => sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: (seed * 37) % 255, g: (seed * 71) % 255, b: 160 } } }).composite([{ input: checker, top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
  const events = [
    ["2024-2025", "Term 2", "2025-03-10 Science fair"],
    ["2025-2026", "Term 1", "2025-09-20 First day"],
    ["2025-2026", "Term 1", "2025-10-12 Sports day"],
    ["2025-2026", "Term 2", "2026-02-15 Museum trip"],
  ];
  let n = 0;
  for (const e of events) {
    const dir = path.join(lib, ...e);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 4; i++) writeFileSync(path.join(dir, `IMG_${1000 + n}.jpg`), await img(n++));
  }

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false, schoolName: "Book Test School" }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1", HUB_TEST_DIR: out },
  });
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

  // A Grade 12 class: Omar and Laila may appear; Nour may not. Ms Hoda teaches it.
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  db.exec("pragma busy_timeout = 5000");
  const addPerson = db.prepare("insert into students (id, name_en, name_ar, grade, class_name, can_post, kind, added_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  addPerson.run("S1", "Omar Hassan", "عمر حسن", "Grade 12", "G12A", 1, "student", Date.now());
  addPerson.run("S2", "Laila Mostafa", "ليلى مصطفى", "Grade 12", "G12A", 1, "student", Date.now());
  addPerson.run("S3", "Nour Adel", "نور عادل", "Grade 12", "G12A", 0, "student", Date.now());
  addPerson.run("T1", "Hoda Samir", "هدى سمير", null, null, 1, "teacher", Date.now());
  db.prepare("insert into class_teachers (class_name, teacher_id) values ('G12A', 'T1')").run();
  db.prepare("insert into school_history (student_id, year, class_name) values ('S1', '2024-2025', 'G11A'), ('S1', '2025-2026', 'G12A')").run();
  const photos = db.prepare("select id, path, year from photos order by path").all() as { id: number; path: string; year: string }[];
  expect(photos.length).toBe(n);
  const face = db.prepare("insert into faces (photo_id, x, y, w, h, score, status, student_id) values (?, ?, 0.3, 0.2, 0.27, 0.99, 'confirmed', ?)");
  const faceOf: Record<string, number> = {};
  photos.forEach((p, i) => {
    faceOf.S1 = Number(face.run(p.id, 0.1, "S1").lastInsertRowid);
    if (p.year === "2025-2026" && i % 2) faceOf.S2 = Number(face.run(p.id, 0.7, "S2").lastInsertRowid);
  });
  // Nour is in one Sports day photo, over the checkerboard.
  const nourPhoto = photos.find((p) => p.path.includes("Sports day"))!;
  faceOf.S3 = Number(face.run(nourPhoto.id, 0.4, "S3").lastInsertRowid);
  db.close();

  // ---------- A Grade 12 yearbook ----------
  const id = await call<number>("newBook", { kind: "grade", year: "2025-2026", grade: "Grade 12" });
  let book = await call<Book>("book", id);
  const types = book.pages.map((p) => p.type);
  for (const t of ["cover", "welcome", "class", "teachers", "firsts", "sports", "trips", "end"]) expect(types, t).toContain(t);
  const classPage = book.pages.find((p) => p.type === "class")!;
  expect(classPage.className).toBe("G12A");
  expect([...(classPage.students ?? [])].sort()).toEqual(["S1", "S2", "S3"]);
  expect(book.pages.find((p) => p.type === "teachers")!.students).toEqual(["T1"]);
  // Only this year's photos, and none with Nour (the book leaves her out).
  const used = book.pages.filter((p) => p.type !== "cover").flatMap((p) => p.photos);
  expect(used).not.toContain(nourPhoto.id);
  expect(used.every((pid) => photos.find((p) => p.id === pid)!.year === "2025-2026")).toBe(true);
  const checks = await call<{ students: number; cantAppear: { id: string }[]; missing: { id: string }[]; lowRes: number[] }>("bookChecks", id);
  expect(checks.students).toBe(3);
  expect(checks.cantAppear.map((s) => s.id)).toEqual(["S3"]);
  expect(checks.missing).toEqual([]);
  expect(checks.lowRes).toEqual([]);
  // Nour's face is never on the class page; Omar's is.
  let html = await call<string>("bookHtml", id);
  expect(html).toMatch(/<img src="hub:\/\/face\/\d+" \/><figcaption><b>Omar Hassan/);
  expect(html).toMatch(/<span>N<\/span><figcaption><b>Nour Adel/);
  expect(html).not.toContain(`hub://face/${faceOf.S3}"`);
  expect(html).toContain("Nour Adel");

  // Printed: one PDF page per book page, A4, every picture found.
  const pdf = await call<{ file: string; pages: number; missing: number }>("bookPdf", id);
  expect(pdf.missing).toBe(0);
  expect(existsSync(pdf.file)).toBe(true);
  let info = pdfInfo(pdf.file);
  expect(info.pages).toBe(book.pages.length);
  expect(info.w).toBeCloseTo(pt(210), 0);
  expect(info.h).toBeCloseTo(pt(297), 0);

  // The same book blurring Nour: her photo comes in, her face blurred in print,
  // and still no face picture of her on the class page.
  await call("saveBook", id, { spec: { cantAppear: "blur" } });
  await call("redraftBook", id);
  book = await call<Book>("book", id);
  expect(book.pages.flatMap((p) => p.photos)).toContain(nourPhoto.id);
  html = await call<string>("bookHtml", id);
  expect(html).toMatch(/<span>N<\/span><figcaption><b>Nour Adel/);
  expect(html).not.toContain(`hub://face/${faceOf.S3}"`);
  expect((await call<{ missing: number }>("bookPdf", id)).missing).toBe(0);
  const blurred = path.join(userData, "cache", "book", `${nourPhoto.id}-b.jpg`);
  expect(existsSync(blurred), "the printed copy with Nour blurred").toBe(true);
  const region = { left: 1000, top: 580, width: 400, height: 400 };
  const sharpness = async (file: string) => (await sharp(await sharp(file).extract(region).toBuffer()).stats()).channels[0].stdev;
  const before = await sharpness(nourPhoto.path);
  const after = await sharpness(blurred);
  expect(after, `checkerboard contrast ${before.toFixed(0)} -> ${after.toFixed(0)}`).toBeLessThan(before / 3);

  // In Arabic, right to left.
  await call("saveBook", id, { spec: { language: "ar" } });
  html = await call<string>("bookHtml", id);
  expect(html).toContain('dir="rtl"');
  expect(html).toContain("فصل G12A");
  expect(html).toContain("نور عادل");

  // A locked page survives a new draft; going back to a version restores it.
  book = await call<Book>("book", id);
  const versionsBefore = book.versions.length;
  await call("bookVersion", id, "Before my edit");
  const welcome = book.pages.find((p) => p.type === "welcome")!;
  const edited = book.pages.map((p) => (p.id === welcome.id ? { ...p, title: "Our principal's word", locked: true } : p));
  await call("saveBook", id, { pages: edited });
  await call("redraftBook", id);
  book = await call<Book>("book", id);
  expect(book.pages.find((p) => p.type === "welcome")!.title).toBe("Our principal's word");
  expect(book.versions.length).toBe(versionsBefore + 1);
  const mine = book.versions.find((v) => v.label === "Before my edit")!;
  await call("bookRestore", id, mine.i);
  book = await call<Book>("book", id);
  expect(book.pages.find((p) => p.type === "welcome")!.title).toBe("A word from the principal");

  // A5 with bleed and crop marks prints larger than the trimmed page.
  await call("saveBook", id, { spec: { size: "A5", bleed: true, cropMarks: true } });
  info = pdfInfo((await call<{ file: string }>("bookPdf", id)).file);
  expect(info.w).toBeCloseTo(pt(148 + 22), 0);
  expect(info.h).toBeCloseTo(pt(210 + 22), 0);

  // ---------- Omar's graduation book: both of his years ----------
  const grad = await call<number>("newBook", { kind: "graduation", year: "2025-2026", studentId: "S1", className: "G12A" });
  const g = await call<Book>("book", grad);
  expect(g.spec.title).toBe("Graduation Omar Hassan");
  expect(g.pages.filter((p) => p.type === "year").map((p) => p.year)).toEqual(["2024-2025", "2025-2026"]);
  expect(g.pages.find((p) => p.type === "class")!.className).toBe("G12A");
  const gPdf = await call<{ file: string; pages: number; missing: number }>("bookPdf", grad);
  expect(gPdf.missing).toBe(0);
  expect(pdfInfo(gPdf.file).pages).toBe(g.pages.length);

  // ---------- A book for every student in G12A ----------
  const sb = await call<number>("newBook", { kind: "student", year: "2025-2026", studentId: "S2", className: "G12A" });
  const sbook = await call<Book>("book", sb);
  expect(sbook.pages.filter((p) => p.type === "student").flatMap((p) => p.photos).length).toBeGreaterThan(0);
  const made = await call<{ made: number; total: number }>("bookStudentBooks", sb);
  expect(made).toEqual({ made: 3, total: 3 });
  const pdfs = readdirSync(out).filter((f) => f.startsWith("G12A "));
  expect(pdfs.sort()).toEqual(["G12A Laila Mostafa.pdf", "G12A Nour Adel.pdf", "G12A Omar Hassan.pdf"]);
  for (const f of pdfs) expect(pdfInfo(path.join(out, f)).pages).toBeGreaterThan(1);

  // ---------- A flipbook ----------
  const flip = await call<{ folder: string; pages: number; missing: number }>("bookFlipbook", grad);
  expect(flip.missing).toBe(0);
  expect(flip.pages).toBe(g.pages.length);
  expect(readdirSync(path.join(flip.folder, "pages")).filter((f) => f.endsWith(".jpg")).length).toBe(g.pages.length);
  expect(readFileSync(path.join(flip.folder, "index.html"), "utf8")).toContain(`const N = ${g.pages.length}`);

  // The Yearbooks tab lists all three books.
  await win.locator('button.nav[data-go="books"]').click();
  await expect(win.locator("body")).toContainText("Graduation Omar Hassan");
  expect((await call<unknown[]>("books")).length).toBe(3);
  await app.close();
});
