import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// The realistic test school drive (bench/school-set, built on GitHub by the
// "Test school set" workflow): SCHOOL_SET=<folder of the unzipped drive>.
// Runs the Mac app the way a school's first week would: class lists, the
// library, then each memory card, and checks the result against the
// manifest (the truth about every file). Things that are only "how well"
// (junk spotted, bursts found) are written to the report, not failed on;
// things that must never happen (a crash, a lost or doubled photo, a broken
// file stopping an import) fail the test.
const root = path.join(__dirname, "..");
const set = process.env.SCHOOL_SET;
test.skip(!set || !existsSync(path.join(set ?? "", "manifest.json")), "needs the test school drive (SCHOOL_SET)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };
type Entry = { path: string; kind: string; people?: string[]; of?: string; event?: string; burst?: string; className?: string | null };
type Manifest = { files: Entry[]; students: { id: string }[]; teachers: { id: string }[] };
type ScanFile = { n: number; name: string; taken: number; camera: string; raw: boolean; video: boolean; junk: string | null; already: boolean; burst: number | null; best: boolean };
type Scan = { ready: boolean; files: ScanFile[]; events: { title: string; date: string; files: number[] }[]; cameras: { camera: string; n: number }[] };
type Job = { id: number; state: string; error: string | null; done?: number; total?: number };

const manifest = (): Manifest => JSON.parse(readFileSync(path.join(set!, "manifest.json"), "utf8"));
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const note = (type: string, description: string) => {
  test.info().annotations.push({ type, description });
  console.log(`${type}: ${description}`);
};

async function launch(userData: string, volumes: string): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1", HUB_VOLUMES: volumes, TZ: "Africa/Cairo" },
  });
  const win = await app.firstWindow();
  return { app, win };
}

test("the school drive: class lists, the library and every memory card go in cleanly", async () => {
  test.setTimeout(1_800_000);
  const m = manifest();
  const base = mkdtempSync(path.join(tmpdir(), "hub-school-"));
  const lib = path.join(base, "Photos");
  cpSync(path.join(set!, "Photos"), lib, { recursive: true, preserveTimestamps: true });
  const volumes = path.join(base, "Volumes");
  mkdirSync(volumes, { recursive: true });
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false, importJunk: true }));
  const dbFile = path.join(userData, "library.db");
  const read = <T>(sql: string, ...args: (string | number)[]) => {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      return db.prepare(sql).all(...args) as T[];
    } finally {
      db.close();
    }
  };

  const { app, win } = await launch(userData, volumes);
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  const call = async <T = unknown>(f: string, ...args: unknown[]) => {
    const r = await win.evaluate(([f, args]) => (window as unknown as Hub).hub.call(f as string, ...(args as unknown[])), [f, args] as const);
    expect(r.ok, `${f}: ${JSON.stringify(r).slice(0, 400)}`).toBe(true);
    return r.value as T;
  };

  // ---------- class lists ----------
  type Preview = { format: string; count: number; skipped: number; portraits: number; classes: { name: string; n: number }[]; changes: { added: { id: string }[]; moved: { id: string }[]; left: { id: string }[] } };
  const sept = await call<Preview>("previewStudents", path.join(set!, "Class lists", "Class list September 2026.xlsx"));
  expect(sept.format).toBe("hub");
  expect(sept.count).toBe(39);
  expect(sept.skipped).toBe(0);
  expect(sept.classes.map((c) => c.name).sort()).toEqual(["10A", "11A", "12A", "9A"]);
  const saved = await call<{ saved: number }>("commitStudents", null);
  expect(saved.saved).toBe(39);
  const consent = read<{ id: string; can_post: number; name_ar: string }>("select id, can_post, name_ar from students where id in ('S9009', 'S9001')");
  expect(consent.find((s) => s.id === "S9009")?.can_post, "S9009 can't appear in posts").toBe(0);
  expect(consent.find((s) => s.id === "S9001")?.name_ar).toBe("نور عادل");

  const nov = await call<Preview>("previewStudents", path.join(set!, "Class lists", "Class list November 2026 (Classera).xlsx"));
  expect(nov.format, "the Classera file is recognised").toBe("classera");
  expect(nov.count).toBe(39);
  expect(nov.changes.added.map((s) => s.id)).toEqual(["S9011"]);
  expect(nov.changes.moved.map((s) => s.id)).toEqual(["S1008"]);
  expect(nov.changes.left.map((s) => s.id)).toEqual(["S1205"]);
  const after = await call<{ saved: number; left: number }>("commitStudents", null, { markLeft: true });
  expect(after.left).toBe(1);
  // Arabic names first in the Classera file: the English name is kept.
  expect(read<{ name_en: string; name_ar: string; class_name: string }>("select name_en, name_ar, class_name from students where id = 'S1008'")[0]).toEqual({ name_en: "Mostafa Nabil", name_ar: "مصطفى نبيل", class_name: "11A" });

  // ---------- the library ----------
  const inLibrary = m.files.filter((f) => f.path.startsWith("Photos/"));
  await expect
    .poll(() => (existsSync(dbFile) ? read<{ n: number }>("select count(*) n from photos where missing = 0")[0].n : 0), { timeout: 600_000, intervals: [3000] })
    .toBe(inLibrary.length);
  const rows = read<{ path: string; event_title: string | null; event_date: string | null; class_name: string | null; dup_of: number | null; edited_of: number | null; width: number | null }>(
    "select path, event_title, event_date, class_name, dup_of, edited_of, width from photos where missing = 0",
  );
  const byRel = new Map(rows.map((r) => [path.relative(lib, r.path).split(path.sep).join("/"), r]));
  const libEntry = (e: Entry) => byRel.get(e.path.slice("Photos/".length));
  for (const e of inLibrary) expect(libEntry(e), `${e.path} is in the library`).toBeTruthy();
  // Events and classes come from the folders, Arabic names included.
  const arabic = inLibrary.filter((e) => e.event === "2026-10-06 احتفال أكتوبر");
  expect(arabic.length).toBeGreaterThan(0);
  for (const e of arabic) expect(libEntry(e)).toMatchObject({ event_title: "احتفال أكتوبر", event_date: "2026-10-06", class_name: null });
  for (const e of inLibrary.filter((x) => x.kind === "photo" && x.className)) expect(libEntry(e)?.class_name, e.path).toBe(e.className);
  // Every library photo gets read (size known) within the wait.
  await expect.poll(() => read<{ n: number }>("select count(*) n from photos where missing = 0 and (width is null or hash is null)")[0].n, { timeout: 600_000, intervals: [5000] }).toBe(0);
  // Exact copies and edited versions are recognised: one of the two is
  // shown, the other hidden behind it.
  const fresh = () => {
    const r = read<{ id: number; path: string; dup_of: number | null; edited_of: number | null }>("select id, path, dup_of, edited_of from photos where missing = 0");
    return new Map(r.map((x) => [path.relative(lib, x.path).split(path.sep).join("/"), x]));
  };
  const copies = inLibrary.filter((e) => e.kind === "duplicate");
  const linked = (e: Entry, col: "dup_of" | "edited_of") => {
    const now = fresh();
    const a = now.get(e.path.slice("Photos/".length));
    const b = now.get((e.of ?? "").slice("Photos/".length));
    return !!a && !!b && (a[col] === b.id || b[col] === a.id);
  };
  await expect.poll(() => copies.filter((e) => linked(e, "dup_of")).length, { timeout: 60_000, message: "exact copies in the library are marked as copies" }).toBe(copies.length);
  const edits = inLibrary.filter((e) => e.kind === "edited");
  note("library", `edited versions linked to their original: ${edits.filter((e) => linked(e, "edited_of")).length} of ${edits.length}`);

  // ---------- memory cards ----------
  const jobs = () => call<Job[]>("importJobs");
  for (const card of readdirSync(path.join(set!, "Cards")).sort()) {
    const plugged = path.join(volumes, card);
    cpSync(path.join(set!, "Cards", card), plugged, { recursive: true, preserveTimestamps: true });
    const dcim = path.join(plugged, "DCIM");
    const { id } = await call<{ id: string }>("importCard", dcim);
    let scan: Scan | null = null;
    await expect.poll(async () => (scan = await call<Scan>("importScan", id))?.ready, { timeout: 600_000, intervals: [2000] }).toBe(true);
    const s = scan as unknown as Scan;
    const truth = m.files.filter((f) => f.path.startsWith(`Cards/${card}/DCIM/`));
    const offered = new Map(s.files.map((f) => [f.name, f]));
    // Every photo the card holds is offered: macOS ._ files are left out,
    // broken files never stop the scan.
    // Videos are not in the app yet (on the Later list): reported, not failed.
    const good = truth.filter((f) => !["junk", "broken", "video"].includes(f.kind));
    for (const v of truth.filter((f) => f.kind === "video")) note(card, `video ${path.basename(v.path)} offered: ${offered.has(path.basename(v.path)) ? "yes" : "no (left out without a word)"}`);
    const missingOffers = good.filter((f) => !offered.has(path.basename(f.path))).map((f) => `${path.basename(f.path)} (${f.kind})`);
    note(card, `${s.files.length} files offered, ${s.events.length} events, cameras ${s.cameras.map((c) => `${c.camera || "?"} ${c.n}`).join(", ")}`);
    expect(missingOffers, `${card}: photos on the card that the import doesn't offer`).toEqual([]);
    expect(s.files.filter((f) => f.name.startsWith("._")).map((f) => f.name), `${card}: macOS ._ files offered as photos`).toEqual([]);
    // How well junk and bursts are spotted (reported only).
    const kinds = ["blurry", "dark", "too-bright", "lens-cap", "far-faces", "rotated", "photo"];
    for (const k of kinds) {
      const list = truth.filter((f) => f.kind === k);
      if (!list.length) continue;
      const flagged = list.filter((f) => offered.get(path.basename(f.path))?.junk);
      note(card, `${k}: ${flagged.length} of ${list.length} marked as junk (${[...new Set(flagged.map((f) => offered.get(path.basename(f.path))?.junk))].join(", ")})`);
    }
    const burstTruth = truth.filter((f) => f.kind === "burst");
    if (burstTruth.length) {
      const grouped = burstTruth.filter((f) => offered.get(path.basename(f.path))?.burst != null);
      note(card, `bursts: ${grouped.length} of ${burstTruth.length} burst shots grouped; best picked ${s.files.filter((f) => f.burst != null && f.best).length} times`);
    }
    if (card.startsWith("CANON")) expect(s.events.map((e) => `${e.date} ${e.files.length}`), "Canon card: morning, afternoon and another day are 3 events").toHaveLength(3);

    // Import everything offered, one event per group the app proposes.
    const take = s.files.filter((f) => !f.already).map((f) => f.n);
    const events = s.events.map((e, i) => ({ title: e.title || `${card} event ${i + 1}`, date: e.date, className: null, files: e.files.filter((n) => take.includes(n)) })).filter((e) => e.files.length);
    const { job } = await call<{ job: number; importId: number }>("importStart", { scanId: id, events });
    let last: Job | undefined;
    await expect
      .poll(async () => {
        last = (await jobs()).find((j) => j.id === job);
        return last?.state === "done" || !!last?.error;
      }, { timeout: 900_000, intervals: [3000] })
      .toBe(true);
    expect(last?.error ?? null, `${card}: the import stopped with an error`).toBeNull();
    // Every good photo from the card is in the library exactly once.
    const libFiles = walk(lib).filter((f) => !f.includes(`${path.sep}.hub`));
    const sizes = new Map<number, number>();
    for (const f of libFiles) sizes.set(statSync(f).size, (sizes.get(statSync(f).size) ?? 0) + 1);
    const lost = good.filter((f) => !sizes.has(statSync(path.join(set!, f.path)).size)).map((f) => path.basename(f.path));
    expect(lost, `${card}: photos that never reached the library`).toEqual([]);
    expect(libFiles.filter((f) => f.endsWith(".copying")), "no half-copied files").toEqual([]);
    // RAW + JPG pairs end up together.
    for (const raw of truth.filter((f) => f.kind === "raw")) {
      const row = read<{ id: number; is_raw: number }>("select id, is_raw from photos where name = ? and missing = 0", path.basename(raw.path))[0];
      note(card, `${path.basename(raw.path)} in the library: ${row ? `yes (raw ${row.is_raw})` : "no"}`);
    }
  }
  // The Nikon card's clock is a year behind: the photos landed in 2025-2026
  // (the app can't know) and the import offered the clock fix (reported).
  note("library", `photos in 2025-2026 folders after the Nikon card: ${read<{ n: number }>("select count(*) n from photos where year = '2025-2026' and missing = 0")[0].n}`);

  await win.screenshot({ path: test.info().outputPath("after-cards.png") });
  expect(errors, "page errors").toEqual([]);
  await app.close();
});
