import { _electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Flaws found 11 Nov 2026 in naming faces (thread "Find flaws in faces and
// app features"). Each check fails on the code before the fix.
//   B-79  Undo turned names the app gave by itself into names "a person
//         gave", which the app then learned from as if they were checked
//   B-80  the Class filter put this year's class on last year's photos
//   B-82  removing a person left their suggestions behind (counted on Today
//         and in events, never shown) and didn't re-check the website block
//   B-83  naming a face didn't free another face already named as the same
//         person in that photo (one person, two faces)
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };

async function img(seed: number) {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: (seed * 53) % 255, g: (seed * 97) % 255, b: (seed * 29) % 255 } } })
    .composite([{ input: Buffer.from(`<svg width="800" height="600"><circle cx="${100 + ((seed * 61) % 600)}" cy="300" r="80" fill="white"/></svg>`), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
}

test("naming faces: undo, removing a person, one face per person, class of the year", async () => {
  test.setTimeout(240_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-flaws-"));
  const lib = path.join(base, "Photos");
  const thisYear = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day", "5A");
  const lastYear = path.join(lib, "2025-2026", "Term 2", "2026-03-01 Science fair", "4A");
  mkdirSync(thisYear, { recursive: true });
  mkdirSync(lastYear, { recursive: true });
  let n = 0;
  for (let i = 0; i < 4; i++) writeFileSync(path.join(thisYear, `IMG_${1000 + i}.jpg`), await img(n++));
  for (let i = 0; i < 2; i++) writeFileSync(path.join(lastYear, `IMG_${2000 + i}.jpg`), await img(n++));

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
    await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 90_000 }).toBe(n);

    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(userData, "library.db"));
    db.exec("pragma busy_timeout = 5000");
    const person = db.prepare("insert into students (id, name_en, class_name, can_post, kind, added_at) values (?, ?, ?, ?, 'student', 1)");
    person.run("SARA", "Sara", "5A", 1); // in 4A last year
    person.run("OMAR", "Omar", "4A", 1); // in 3A last year
    person.run("NOUR", "Nour", "5A", 0); // can't appear
    db.prepare("insert into school_history (student_id, year, class_name) values ('SARA', '2025-2026', '4A'), ('OMAR', '2025-2026', '3A'), ('NOUR', '2025-2026', '4A')").run();
    const photos = db.prepare("select id, path from photos order by path").all() as { id: number; path: string }[];
    const ofThisYear = photos.filter((p) => p.path.includes("Sports day")).map((p) => p.id);
    const ofLastYear = photos.filter((p) => p.path.includes("Science fair")).map((p) => p.id);
    const add = db.prepare("insert into faces (photo_id, x, y, w, h, score, status, student_id, suggest_id, suggest_score, auto, named_by) values (?, ?, 0.2, 0.15, 0.2, 0.95, ?, ?, ?, ?, ?, ?)");
    const face = (photo: number, x: number, status: string, student: string | null, o: { suggest?: string; score?: number; auto?: boolean } = {}) =>
      Number(add.run(photo, x, status, student, o.suggest ?? null, o.score ?? null, o.auto ? 1 : 0, o.auto ? "auto" : status === "confirmed" ? "me" : null).lastInsertRowid);
    // Photo 1: the app named Sara by itself, and suggests Omar for another face.
    const autoSara = face(ofThisYear[0], 0.1, "confirmed", "SARA", { suggest: "SARA", score: 0.7, auto: true });
    const sugOmar = face(ofThisYear[0], 0.5, "suggested", null, { suggest: "OMAR", score: 0.58 });
    // Photo 2: Sara named by hand on the wrong face; the right face is unnamed.
    const wrongSara = face(ofThisYear[1], 0.1, "confirmed", "SARA");
    const rightSara = face(ofThisYear[1], 0.5, "unknown", null);
    // Photo 3: Nour suggested; she can't appear.
    const sugNour = face(ofThisYear[2], 0.3, "suggested", null, { suggest: "NOUR", score: 0.6 });
    // Last year's science fair: Sara (4A then) and Omar (3A then) named.
    face(ofLastYear[0], 0.2, "confirmed", "SARA");
    face(ofLastYear[1], 0.2, "confirmed", "OMAR");
    const row = (id: number) => db.prepare("select status, student_id, suggest_id, auto, named_by, rejected from faces where id = ?").get(id) as { status: string; student_id: string | null; suggest_id: string | null; auto: number; named_by: string | null; rejected: string } | undefined;

    // ---------- B-79: Undo keeps who named a face ----------
    // Saying "Omar" for the suggested face frees nothing else; then confirming
    // Omar on the face the app named Sara frees Sara's auto name. Undo must
    // bring back "named by the app", not "named by a person".
    await call("confirmFaces", [autoSara], "OMAR");
    expect(row(autoSara)).toMatchObject({ status: "confirmed", student_id: "OMAR", auto: 0 });
    await call("undo");
    expect(row(autoSara), "B-79: the app's own name comes back as the app's").toMatchObject({ status: "confirmed", student_id: "SARA", auto: 1, named_by: "auto" });
    expect(row(sugOmar)).toMatchObject({ status: "suggested", suggest_id: "OMAR" });
    await call("rejectFaces", [autoSara]);
    await call("undo");
    expect(row(autoSara), "B-79: after 'not Sara' and Undo").toMatchObject({ status: "confirmed", student_id: "SARA", auto: 1, named_by: "auto" });

    // ---------- B-83: one face per person per photo ----------
    await call("confirmFaces", [rightSara], "SARA");
    expect(row(rightSara)).toMatchObject({ status: "confirmed", student_id: "SARA" });
    expect(row(wrongSara), "B-83: the face wrongly named Sara is free again").toMatchObject({ status: "unknown", student_id: null });
    expect(row(wrongSara)!.rejected.split(",")).toContain("SARA");
    const named = db.prepare("select count(*) n from faces where photo_id = ? and student_id = 'SARA' and status = 'confirmed'").get(ofThisYear[1]) as { n: number };
    expect(named.n).toBe(1);

    // ---------- B-80: the Class filter on last year's photos ----------
    const inClass = async (className: string, year: string) => (await call<{ id: number }[] | { list: { id: number }[] }>("photos", { className, year })) as unknown;
    const ids = (v: unknown) => ((Array.isArray(v) ? v : (v as { list: { id: number }[] }).list) as { id: number }[]).map((p) => p.id).sort();
    // Last year's 3A had Omar in it (his photo is filed in the 4A folder by mistake)
    expect(ids(await inClass("3A", "2025-2026")), "B-80: Omar was in 3A last year").toEqual([ofLastYear[1]]);
    // ...and this year's 5A filter on last year doesn't pull in Sara's 4A photo
    expect(ids(await inClass("5A", "2025-2026")), "B-80: Sara wasn't in 5A last year").toEqual([]);
    // This year: Sara's photos are 5A
    expect(ids(await inClass("5A", "2026-2027"))).toEqual([...ofThisYear].sort());

    // Naming last year's 4A class photo row by row offers last year's 4A
    const cp = await call<{ className: string; people: { id: string }[] }>("classPhoto", ofLastYear[0]);
    expect(cp.className).toBe("4A");
    expect(cp.people.map((p) => p.id).sort(), "B-80: last year's 4A, not this year's").toEqual(["NOUR", "SARA"]);

    // ---------- B-82: removing a person ----------
    await call("removeStudent", "NOUR");
    expect(row(sugNour), "B-82: no suggestion left for someone who's gone").toMatchObject({ status: "unknown", suggest_id: null });
    const left = db.prepare("select count(*) n from faces where suggest_id = 'NOUR' or student_id = 'NOUR'").get() as { n: number };
    expect(left.n).toBe(0);
    db.close();
  } finally {
    await app.close();
  }
});
