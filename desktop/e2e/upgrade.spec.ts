import { _electron, expect, test } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// B-20 / 0.5 checklist "Upgrade safety": libraries made by the real 0.3 and
// 0.4 apps (e2e/fixtures/library-0.3 and -0.4, made by make-old-library.spec.ts)
// open in this version with every photo, event, name, face, album and setting
// kept, the photos untouched, and a backup made before anything changed.
const root = path.join(__dirname, "..");

function sqlite(file: string) {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(file);
}

function files(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of readdirSync(dir, { recursive: true }) as string[]) {
    const p = path.join(dir, e);
    if (statSync(p).isFile()) out[e] = statSync(p).size;
  }
  return out;
}

async function launch(userData: string) {
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  return { app, win, errors };
}

for (const old of ["0.3", "0.4"]) test(`a library made with ${old} opens in this version and keeps everything`, async () => {
  test.setTimeout(180_000);
  const fixture = path.join(__dirname, "fixtures", `library-${old}`);
  // 0.3 had no teachers or parents yet, and didn't note its version.
  const v3 = old === "0.3";
  const base = mkdtempSync(path.join(tmpdir(), "hub-up-"));
  cpSync(fixture, base, { recursive: true });
  const userData = path.join(base, "AppData");
  const lib = path.join(base, "Photos");
  // Put the library where this test made it.
  const fix = sqlite(path.join(userData, "library.db"));
  fix.prepare("update photos set path = replace(path, '__ROOT__', ?)").run(base);
  fix.close();
  for (const f of readdirSync(userData)) if (f.endsWith(".json")) writeFileSync(path.join(userData, f), readFileSync(path.join(userData, f), "utf8").split("__ROOT__").join(JSON.stringify(base).slice(1, -1)));
  const before = files(lib);
  const settingsBefore = JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8"));
  if (v3) expect(existsSync(path.join(userData, "last-version.txt"))).toBe(false);
  else expect(readFileSync(path.join(userData, "last-version.txt"), "utf8").trim()).toBe("0.4.0");

  const { app, win, errors } = await launch(userData);
  const version = await app.evaluate(({ app }) => app.getVersion());
  expect(version).not.toBe(`${old}.0`);

  // A backup of the old library was made before this version changed it.
  const backups = readdirSync(path.join(userData, "backups"));
  expect(backups).toHaveLength(1);
  expect(backups[0]).toMatch(v3 ? /from-old$/ : /from-0\.4\.0$/);
  const bdir = path.join(userData, "backups", backups[0]);
  for (const f of ["library.db", "settings.json", "version.txt"]) expect(existsSync(path.join(bdir, f))).toBe(true);
  const bdb = sqlite(path.join(bdir, "library.db"));
  expect((bdb.prepare("select count(*) n from photos").get() as { n: number }).n).toBe(10);
  bdb.close();

  // The library shows all ten photos in their two events.
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(10);
  const events = (await win.evaluate("[...new Set(lib.list.map((p) => p.event_title))].sort()")) as string[];
  expect(events).toEqual(["Book week 2025", "Sports day"]);
  // Students page lists the three students.
  await win.locator('button.nav[data-go="students"]').click();
  await expect(win.locator("body")).toContainText("Youssef Adel");
  await expect(win.locator("body")).toContainText("Omar Khaled");
  await win.waitForTimeout(1500);
  await app.close();
  expect(errors).toEqual([]);

  // Everything the school made in the old version is still there.
  const db = sqlite(path.join(userData, "library.db"));
  const photos = db.prepare("select name, event_title, rating, flag, label from photos order by name").all() as { name: string; event_title: string; rating: number; flag: number; label: string | null }[];
  expect(photos).toHaveLength(10);
  const p = (n: string) => photos.find((x) => x.name === n)!;
  expect(p("IMG_1000.jpg").rating).toBe(5);
  expect(p("IMG_1002.jpg").rating).toBe(3);
  expect(p("IMG_1003.jpg").flag).toBe(1);
  expect(p("IMG_1004.jpg").flag).toBe(-1);
  expect(p("IMG_2001.jpg").label).toBe("green");
  expect(p("IMG_2000.jpg").event_title).toBe("Book week 2025");
  const people = db.prepare("select id, name_en, name_ar, class_name, kind, main_face from students order by id").all() as { id: string; name_en: string; name_ar: string; class_name: string | null; kind: string; main_face: number | null }[];
  expect(people.map((s) => [s.id, s.name_en, s.name_ar, s.kind])).toEqual([
    ...(v3 ? [] : [["P1", "Adel Mahmoud", "عادل محمود", "parent"]]),
    ["S100", "Youssef Adel", "يوسف عادل", "student"],
    ["S101", "Mariam Hany", "مريم هاني", "student"],
    ["S102", "Omar Khaled", "عمر خالد", "student"],
    ...(v3 ? [] : [["T1", "Ms Salma", "أ. سلمى", "teacher"]]),
  ]);
  expect(people.find((s) => s.id === "S100")!.class_name).toBe("G3A");
  expect(db.prepare("select a, b, kind from links").all().map((r) => ({ ...r }))).toEqual(v3 ? [] : [{ a: "P1", b: "S100", kind: "parent" }]);
  const faces = db.prepare("select p.name, f.student_id, f.status, length(f.embedding) bytes from faces f join photos p on p.id = f.photo_id order by p.name, f.student_id").all().map((r) => ({ ...r }));
  expect(faces).toEqual([
    { name: "IMG_1000.jpg", student_id: "S100", status: "manual", bytes: null },
    { name: "IMG_1001.jpg", student_id: "S100", status: "manual", bytes: null },
    { name: "IMG_1001.jpg", student_id: "S101", status: "manual", bytes: null },
    { name: "IMG_1005.jpg", student_id: "S102", status: "confirmed", bytes: 512 },
    { name: "IMG_2000.jpg", student_id: v3 ? "S102" : "T1", status: "manual", bytes: null },
  ]);
  const omar = people.find((s) => s.id === "S102")!;
  if (!v3) expect(omar.main_face).not.toBeNull();
  if (omar.main_face) expect((db.prepare("select student_id from faces where id = ?").get(omar.main_face) as { student_id: string }).student_id).toBe("S102");
  const album = db.prepare("select a.name, count(ap.photo_id) n from albums a left join album_photos ap on ap.album_id = a.id group by a.id").all().map((r) => ({ ...r }));
  expect(album).toEqual([{ name: "Front page", n: 2 }]);
  db.close();

  // Settings the school changed are kept.
  const settings = JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8"));
  for (const k of ["theme", "textSize", "accent", "quietFrom", "quietTo", "splitGap", "importPhotographer", "schoolName", "terms", "library", "language"]) expect(settings[k]).toEqual(settingsBefore[k]);
  // The photos themselves weren't touched.
  expect(files(lib)).toEqual(before);
  expect(readFileSync(path.join(userData, "last-version.txt"), "utf8").trim()).toBe(version);

  // Opening again makes no second backup.
  const again = await launch(userData);
  await again.win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => again.win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(10);
  await again.app.close();
  expect(readdirSync(path.join(userData, "backups"))).toHaveLength(1);
});
