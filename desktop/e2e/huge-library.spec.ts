import { _electron, expect, test } from "@playwright/test";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// A school's library after a few years: 20,000 photos in 100 events. The app
// must still open, show the library, search and switch tabs quickly. The
// photos are real files on disk (hard links, so the test stays small) and the
// library already knows them, as it would after the first import.
const root = path.join(__dirname, "..");
const EVENTS = 100;
const PER_EVENT = 200;
const TABS = ["today", "library", "faces", "students", "coverage", "cleanup", "posts", "calendar", "history", "settings"];

type W = { lib: { list: unknown[] }; hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };

function launch(userData: string) {
  return _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    // A time zone with no summer time, so the test knows each photo's local day.
    env: { ...process.env, HUB_TEST: "1", TZ: "Asia/Dubai" },
  });
}

test("a library of 20,000 photos stays quick", async () => {
  test.setTimeout(600_000);
  const base = mkdtempSync(path.join(tmpdir(), "hub-huge-"));
  const lib = path.join(base, "Photos");
  const folders: string[] = [];
  for (let e = 0; e < EVENTS; e++) {
    const year = e < 50 ? "2024-2025" : "2025-2026";
    const term = `Term ${(e % 3) + 1}`;
    const day = `2025-${String((e % 12) + 1).padStart(2, "0")}-${String((e % 27) + 1).padStart(2, "0")}`;
    const dir = path.join(lib, year, term, `${day} Event ${e}`);
    mkdirSync(dir, { recursive: true });
    const img = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: (e * 37) % 255, g: (e * 91) % 255, b: (e * 53) % 255 } } })
      .composite([{ input: Buffer.from(`<svg width="640" height="480"><rect x="${(e * 6) % 600}" y="40" width="40" height="400" fill="white"/></svg>`), top: 0, left: 0 }])
      .jpeg()
      .toBuffer();
    writeFileSync(path.join(dir, "IMG_0000.jpg"), img);
    folders.push(dir);
  }
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));

  // First the app reads one photo per event, as a school's first import would.
  let app = await launch(userData);
  let win = await app.firstWindow();
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 120_000 }).toBe(EVENTS);
  await expect.poll(() => win.evaluate("lib.list.filter((p) => p.thumb === 1).length"), { timeout: 120_000 }).toBe(EVENTS);
  await app.close();

  // Then 199 more in each event: same file on disk, its own row and thumbnail.
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  const cols = (db.prepare("pragma table_info(photos)").all() as { name: string }[]).map((c) => c.name).filter((c) => !["id", "path", "name", "hash"].includes(c));
  const rows = db.prepare("select id, path from photos").all() as { id: number; path: string }[];
  const copy = db.prepare(`insert into photos (path, name, hash, ${cols.join(", ")}) select ?, ?, ?, ${cols.join(", ")} from photos where id = ?`);
  const thumbs = path.join(userData, "cache", "thumbs");
  db.exec("begin");
  let n = 0;
  for (const r of rows) {
    for (let i = 1; i < PER_EVENT; i++) {
      const name = `IMG_${String(i).padStart(4, "0")}.jpg`;
      const file = path.join(path.dirname(r.path), name);
      linkSync(r.path, file);
      const id = Number(copy.run(file, name, `huge-${++n}`, r.id).lastInsertRowid);
      linkSync(path.join(thumbs, `${r.id}.jpg`), path.join(thumbs, `${id}.jpg`));
    }
  }
  db.exec("commit");
  expect((db.prepare("select count(*) n from photos").get() as { n: number }).n).toBe(EVENTS * PER_EVENT);

  // Release 0.10, item 9: what the school searches by. 600 students in 20
  // classes, named in the photos; some photos filed in a class folder; three
  // students who can't appear; each photo taken at its own time, some just
  // after midnight (the day in Dubai, UTC+4, is the day before in UTC).
  const CLASSES = Array.from({ length: 20 }, (_, i) => `${Math.floor(i / 4) + 1}${"ABCD"[i % 4]}`);
  db.exec("begin");
  const addStudent = db.prepare("insert into students (id, name_en, class_name, can_post, added_at) values (?, ?, ?, ?, 0)");
  for (let i = 0; i < 600; i++) addStudent.run(`S${i}`, `Student ${i} ${["Adel", "Hassan", "Nour", "Salma", "Omar"][i % 5]}`, CLASSES[i % 20], i === 7 || i === 70 || i === 300 ? 0 : 1);
  const all = db.prepare("select id, event_key, event_date from photos order by id").all() as { id: number; event_key: string; event_date: string }[];
  const setPhoto = db.prepare("update photos set taken_at = ?, class_name = ?, face_count = ?, faces_scanned = 1 where id = ?");
  const addFace = db.prepare("insert into faces (photo_id, x, y, w, h, student_id, status, suggest_id) values (?, 0.1, 0.1, 0.2, 0.2, ?, ?, ?)");
  const want = { byStudent: new Map<string, Set<number>>(), byClass: new Map<string, Set<number>>(), noPost: new Set<number>(), byDay: new Map<string, Set<number>>() };
  const addTo = <K>(m: Map<K, Set<number>>, k: K, id: number) => m.set(k, (m.get(k) ?? new Set()).add(id));
  all.forEach((p, n) => {
    const e = Number(/Event (\d+)$/.exec(p.event_key)![1]);
    // Event 7's photos start at 00:30 local; the rest at 10:00.
    const local = Date.parse(`${p.event_date}T${e === 7 ? "00:30" : "10:00"}:00Z`) + (n % PER_EVENT) * 60_000;
    const takenUtc = new Date(local - 4 * 3600_000).toISOString();
    const filed = e % 10 === 3 ? CLASSES[e % 20] : null;
    if (filed) addTo(want.byClass, filed, p.id);
    addTo(want.byDay, new Date(local).toISOString().slice(0, 10), p.id);
    const named = [(n * 7) % 600, (n * 13 + 5) % 600].slice(0, n % 3);
    for (const st of named) {
      addFace.run(p.id, `S${st}`, "confirmed", null);
      addTo(want.byStudent, `S${st}`, p.id);
      addTo(want.byClass, CLASSES[st % 20], p.id);
      if (st === 7 || st === 70 || st === 300) want.noPost.add(p.id);
    }
    // Every 97th photo has an unconfirmed suggestion of student 300.
    if (n % 97 === 0) {
      addFace.run(p.id, null, "suggested", "S300");
      want.noPost.add(p.id);
    }
    setPhoto.run(takenUtc, filed, named.length + (n % 97 === 0 ? 1 : 0), p.id);
  });
  db.exec("commit");
  db.close();
  expect(readdirSync(folders[0])).toHaveLength(PER_EVENT);

  // Open it again: everything below is what the school feels.
  const t0 = Date.now();
  app = await launch(userData);
  win = await app.firstWindow();
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  await win.locator('button.nav[data-go="library"]').click();
  // The grid holds the first 8,000; the title gives the real size and says how to see the rest.
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 120_000 }).toBe(8000);
  await expect(win.locator("#libsub")).toContainText("20,000 photos");
  await expect(win.locator("#libsub")).toContainText("choose a year or event");
  await expect(win.locator(".tile img").first()).toBeVisible({ timeout: 30_000 });
  const openLibrary = Date.now() - t0;

  // Scroll to the bottom and back: pictures keep showing.
  const scroll = Date.now();
  await win.evaluate(async () => {
    const el = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 1000 && getComputedStyle(e).overflowY !== "visible") as HTMLElement;
    for (let i = 1; i <= 10; i++) {
      el.scrollTop = (el.scrollHeight * i) / 10;
      await new Promise((r) => setTimeout(r, 50));
    }
    el.scrollTop = 0;
  });
  const scrolled = Date.now() - scroll;

  // Search for one event.
  const s0 = Date.now();
  const found = (await win.evaluate(async () => (await (window as unknown as W).hub.call("search", "Event 42")).value)) as unknown;
  const search = Date.now() - s0;
  expect(JSON.stringify(found)).toContain("Event 42");

  // Filters return exactly the right photos, each in under a second.
  type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };
  const timed: Record<string, number> = {};
  const ids = async (label: string, f: object, how: "photos" | "rule" = "photos") => {
    const t = Date.now();
    const r = (await win.evaluate(async ([how, f]) => {
      const h = (window as unknown as Hub).hub;
      if (how === "rule") {
        const id = (await h.call("newAlbum", "Test", f)).value as number;
        const rows = (await h.call("photos", { album: `my:${id}`, limit: 30000 })).value as { id: number }[];
        await h.call("deleteAlbum", id);
        return rows.map((p) => p.id);
      }
      return ((await h.call("photos", { ...(f as object), limit: 30000 })).value as { id: number }[]).map((p) => p.id);
    }, [how, f] as const)) as number[];
    timed[label] = Date.now() - t;
    return new Set(r);
  };
  const same = (a: Set<number>, b: Set<number> | undefined, what: string) => {
    const missing = [...(b ?? [])].filter((x) => !a.has(x)).length;
    const extra = [...a].filter((x) => !(b ?? new Set()).has(x)).length;
    expect({ what, missing, extra, n: a.size }).toEqual({ what, missing: 0, extra: 0, n: b?.size ?? 0 });
  };
  same(await ids("student", { student: "S42" }), want.byStudent.get("S42"), "a student's photos");
  same(await ids("class", { className: "3B" }), want.byClass.get("3B"), "a class's photos");
  same(await ids("class rule", { className: "3B" }, "rule"), want.byClass.get("3B"), "a smart album for a class");
  same(await ids("event", { search: "Event 42" }), new Set(all.filter((p) => p.event_key.endsWith("Event 42")).map((p) => p.id)), "an event by name");
  const day7 = all.find((p) => p.event_key.endsWith(" Event 7"))!.event_date;
  same(await ids("date rule", { from: day7, to: day7 }, "rule"), want.byDay.get(day7), "photos of one day (some just after midnight)");
  same(await ids("can't appear", { album: "nopost" }), want.noPost, "photos with a student who can't appear");
  const t1 = Date.now();
  const count = (await win.evaluate(async () => (await (window as unknown as Hub).hub.call("countPhotos", { album: "nopost" })).value)) as number;
  timed["count can't appear"] = Date.now() - t1;
  expect(count).toBe(want.noPost.size);
  console.log("huge-library filters", JSON.stringify(timed));
  for (const [what, ms] of Object.entries(timed)) expect(ms, what).toBeLessThan(1000);

  // Every tab answers.
  const clicks: Record<string, number> = {};
  for (const tab of TABS) {
    const c0 = Date.now();
    await win.locator(`button.nav[data-go="${tab}"]`).click();
    await expect(win.locator(`button.nav.on[data-go="${tab}"]`)).toBeVisible();
    clicks[tab] = Date.now() - c0;
  }
  await app.close();

  const slowest = Math.max(...Object.values(clicks));
  console.log("huge-library", JSON.stringify({ photos: EVENTS * PER_EVENT, openLibrary, scrolled, search, slowestTab: slowest, clicks }));
  expect(errors).toEqual([]);
  expect(openLibrary).toBeLessThan(20_000);
  expect(search).toBeLessThan(2_000);
  expect(slowest).toBeLessThan(2_000);
});
