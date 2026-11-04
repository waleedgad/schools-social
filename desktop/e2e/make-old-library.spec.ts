import { _electron, expect, test } from "@playwright/test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Makes the "library made with 0.4" that upgrade.spec.ts opens. Not a check:
// it only runs when OLD_APP points at a built copy of the 0.4 app
// (git archive f7a5c31 desktop, link node_modules, npm run build).
// The result is saved in e2e/fixtures/library-0.4 with the folder written
// as __ROOT__, so the test can put it anywhere.
test.skip(!process.env.OLD_APP, "only when making the 0.4 library");

const out = path.join(__dirname, "fixtures", "library-0.4");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };

async function jpeg(file: string, seed: number) {
  const img = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: (seed * 47) % 255, g: (seed * 89) % 255, b: (seed * 31) % 255 } } })
    .composite([{ input: Buffer.from(`<svg width="320" height="240"><rect x="${(seed * 40) % 280}" y="20" width="30" height="200" fill="white"/></svg>`), top: 0, left: 0 }])
    .jpeg({ quality: 70 })
    .toBuffer();
  writeFileSync(file, img);
}

function replaceIn(file: string, from: string, to: string) {
  writeFileSync(file, readFileSync(file, "utf8").split(from).join(to));
}

test("make a library with the 0.4 app", async () => {
  test.setTimeout(180_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-old-"));
  const lib = path.join(base, "Photos");
  const sports = path.join(lib, "2025-2026", "Term 1", "2025-10-12 Sports day");
  const books = path.join(lib, "2025-2026", "Term 1", "2025-10-20 Book week");
  mkdirSync(sports, { recursive: true });
  mkdirSync(books, { recursive: true });
  for (let i = 0; i < 6; i++) await jpeg(path.join(sports, `IMG_10${String(i).padStart(2, "0")}.jpg`), i + 1);
  for (let i = 0; i < 4; i++) await jpeg(path.join(books, `IMG_20${String(i).padStart(2, "0")}.jpg`), i + 20);
  const userData = path.join(base, "AppData");
  mkdirSync(userData);
  // Settings a school would have changed from the defaults.
  writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      language: "en", setupDone: true, tourDone: true, wizard: {}, library: lib, faces: false,
      theme: "dark", textSize: "large", accent: "#c0392b", quietFrom: "20:00", quietTo: "08:00",
      splitGap: 3, importPhotographer: "Mona", schoolName: "Test School",
      terms: [{ name: "Term 1", from: "2025-09-01", to: "2025-12-20" }],
    }),
  );
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [process.env.OLD_APP!, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  expect(await app.evaluate(({ app }) => app.getVersion())).toBe("0.4.0");
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(10);
  const call = (f: string, ...a: unknown[]) => win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
  const photos = (await win.evaluate("lib.list.map((p) => ({ id: p.id, name: p.name }))")) as { id: number; name: string }[];
  const id = (n: string) => photos.find((p) => p.name === n)!.id;

  // Names, a teacher and a parent.
  for (const s of [
    { id: "S100", name_en: "Youssef Adel", name_ar: "يوسف عادل", class_name: "G3A" },
    { id: "S101", name_en: "Mariam Hany", name_ar: "مريم هاني", class_name: "G3A" },
    { id: "S102", name_en: "Omar Khaled", name_ar: "عمر خالد", class_name: "G4B" },
    { id: "T1", name_en: "Ms Salma", name_ar: "أ. سلمى", class_name: "", kind: "teacher" },
    { id: "P1", name_en: "Adel Mahmoud", name_ar: "عادل محمود", class_name: "", kind: "parent", linkTo: "S100" },
  ]) expect((await call("addStudent", s)).ok).toBe(true);
  // Tags, stars, flags, colours, an album and a renamed event.
  await call("tagPhotos", [id("IMG_1000.jpg"), id("IMG_1001.jpg")], "S100");
  await call("tagPhotos", [id("IMG_1001.jpg")], "S101");
  await call("tagPhotos", [id("IMG_2000.jpg")], "T1");
  await call("rate", [id("IMG_1000.jpg")], 5);
  await call("rate", [id("IMG_1002.jpg")], 3);
  await call("flag", [id("IMG_1003.jpg")], 1);
  await call("flag", [id("IMG_1004.jpg")], -1);
  await call("label", [id("IMG_2001.jpg")], "green");
  expect((await call("newAlbum", "Front page", null, [id("IMG_1000.jpg"), id("IMG_2000.jpg")])).ok).toBe(true);
  const ev = (await win.evaluate("lib.list.find((p) => p.name === 'IMG_2000.jpg').event_key")) as string;
  await call("renameEvent", ev, "Book week 2025", "2025-10-21");
  await expect.poll(() => win.evaluate("lib.list.find((p) => p.name === 'IMG_2000.jpg')?.event_title"), { timeout: 20_000 }).toBe("Book week 2025");
  await app.close();

  // A face the 0.4 face finder would have saved, with its numbers.
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  const emb = Buffer.from(new Float32Array(128).map((_, i) => Math.sin(i)).buffer);
  db.prepare("insert into faces (photo_id, x, y, w, h, score, embedding, student_id, status) values (?, 0.2, 0.2, 0.3, 0.4, 0.97, ?, 'S102', 'confirmed')").run(id("IMG_1005.jpg"), emb);
  db.prepare("update students set main_face = (select max(id) from faces) where id = 'S102'").run();
  db.exec("pragma wal_checkpoint(truncate)");
  db.close();

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(lib, path.join(out, "Photos"), { recursive: true });
  mkdirSync(path.join(out, "AppData"));
  for (const f of readdirSync(userData)) {
    // Only what the app keeps; Electron's own caches and logs stay behind.
    if (!/^(library\.db|settings\.json|queue\.json|events\.json|web-checks\.json|last-version\.txt)$/.test(f)) continue;
    if (!statSync(path.join(userData, f)).isFile()) continue;
    cpSync(path.join(userData, f), path.join(out, "AppData", f));
  }
  // The database keeps whole paths; the test swaps __ROOT__ for its own folder.
  const { DatabaseSync: D } = require("node:sqlite") as typeof import("node:sqlite");
  const odb = new D(path.join(out, "AppData", "library.db"));
  odb.prepare("update photos set path = replace(path, ?, '__ROOT__')").run(base);
  odb.exec("vacuum");
  odb.close();
  for (const f of readdirSync(path.join(out, "AppData"))) if (f.endsWith(".json")) replaceIn(path.join(out, "AppData", f), JSON.stringify(base).slice(1, -1), "__ROOT__");
  rmSync(base, { recursive: true, force: true });
});
