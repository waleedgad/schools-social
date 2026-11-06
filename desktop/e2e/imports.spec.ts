import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Release 0.10, items 1-3: imports never lose, double or misfile a photo.
// A folder stands in for the computer's list of plugged-in cards
// (HUB_VOLUMES), so "plugging a card in" is making a folder with a DCIM in it
// and "pulling it out" is moving that folder away.
const root = path.join(__dirname, "..");
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };
type Job = { id: number; importId: number; state: string; done: number; total: number; waitingForCard: boolean; paused?: boolean; error?: string | null };

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

// Every file under a folder, with its bytes' hash.
function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const snapshot = (dir: string) => walk(dir).sort().map((f) => `${path.relative(dir, f)}|${statSync(f).size}|${Math.round(statSync(f).mtimeMs)}|${sha(f)}`);

// Photos of noise (so they're big and each one different), 3 minutes apart
// on 12 Oct 2026, so the card makes one event that isn't a burst.
async function makeCard(dcim: string, count: number, size = { w: 900, h: 700 }) {
  const dir = path.join(dcim, "100CANON");
  mkdirSync(dir, { recursive: true });
  const raw = Buffer.alloc(size.w * size.h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  const start = Date.parse("2026-10-12T09:00:00");
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 64; k++) raw[(i * 7919 + k * 104729) % raw.length] = (i + k) & 255;
    const file = path.join(dir, `IMG_${String(i).padStart(4, "0")}.JPG`);
    writeFileSync(file, await sharp(raw, { raw: { width: size.w, height: size.h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer());
    const t = new Date(start + i * 180_000);
    utimesSync(file, t, t);
  }
}

async function launch(userData: string, volumes: string) {
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1", HUB_VOLUMES: volumes, TZ: "Africa/Cairo" },
  });
  const win = await app.firstWindow();
  await expect(win.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 30_000 });
  return { app, win };
}

function setup() {
  const base = mkdtempSync(path.join(tmpdir(), "hub-imp-"));
  const lib = path.join(base, "Photos");
  const volumes = path.join(base, "Volumes");
  mkdirSync(lib, { recursive: true });
  mkdirSync(volumes, { recursive: true });
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  return { base, lib, volumes, userData };
}

const call = async (win: Page, f: string, ...a: unknown[]) => (await win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const)).value;
const jobs = async (win: Page) => (await call(win, "importJobs")) as Job[];

// Read a card and start importing all of it as one event, the way the
// Import tab does when "Import" is pressed.
async function startImport(win: Page, dcim: string, title = "Sports day", className = "3A") {
  const { id } = (await call(win, "importCard", dcim)) as { id: string };
  let scan: { ready: boolean; files: { n: number }[] } | null = null;
  await expect.poll(async () => (scan = (await call(win, "importScan", id)) as typeof scan)?.ready, { timeout: 120_000 }).toBe(true);
  const files = scan!.files.map((f) => f.n);
  return (await call(win, "importStart", { scanId: id, events: [{ title, date: "2026-10-12", className, files }] })) as { job: number; importId: number };
}

const jobOf = async (win: Page, id: number) => (await jobs(win)).find((j) => j.id === id);

// The library has each card photo exactly once, filed in
// Year / Term / Event / Class, and nothing half-copied.
function checkLibrary(lib: string, card: string, eventDir = "2026-10-12 Sports day", className = "3A") {
  const want = new Map(walk(card).map((f) => [sha(f), path.basename(f)]));
  const files = walk(lib).filter((f) => !f.includes(`${path.sep}.hub`) && !f.endsWith(".db") && !f.endsWith(".db-wal") && !f.endsWith(".db-shm"));
  const copying = files.filter((f) => f.endsWith(".copying"));
  expect(copying, "no half-copied files left").toEqual([]);
  const photos = files.filter((f) => /\.jpe?g$/i.test(f));
  const byHash = new Map<string, string[]>();
  for (const f of photos) byHash.set(sha(f), [...(byHash.get(sha(f)) ?? []), f]);
  const doubled = [...byHash.values()].filter((v) => v.length > 1);
  expect(doubled, "no photo copied twice").toEqual([]);
  expect([...byHash.keys()].filter((h) => !want.has(h)), "nothing in the library that isn't on the card").toEqual([]);
  expect([...want.keys()].filter((h) => !byHash.has(h)).map((h) => want.get(h)), "every card photo is in the library").toEqual([]);
  for (const f of photos) {
    const parts = path.relative(lib, f).split(path.sep);
    expect(parts.length, f).toBe(5);
    expect(parts[0]).toMatch(/^2026-2027$/);
    expect(parts[2]).toBe(eventDir);
    expect(parts[3]).toBe(className);
  }
  return photos.length;
}

// Move a folder, retrying while Windows says a file in it is busy.
async function move(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      return renameSync(from, to);
    } catch (e) {
      if (i > 200) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

test("a memory card is found, filed by year, term, event and class, left untouched, and never copied twice", async () => {
  test.setTimeout(240_000);
  const { base, lib, volumes, userData } = setup();
  const { app, win } = await launch(userData, volumes);
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  // A card made away from the computer, then "plugged in".
  const away = path.join(base, "away", "CARD1");
  await makeCard(path.join(away, "DCIM"), 30, { w: 320, h: 240 });
  const before = snapshot(away);
  await move(away, path.join(volumes, "CARD1"));
  const card = path.join(volumes, "CARD1");

  // The app notices it by itself and offers it.
  await expect(win.locator("#i-dev")).toBeVisible({ timeout: 30_000 });
  await expect(win.locator(".card.hl")).toContainText("Card “CARD1” is plugged in");
  await win.locator("#i-dev").click();
  await expect(win.locator(".ibar")).toBeVisible({ timeout: 60_000 });
  await expect(win.locator("#i-count")).toContainText("30 photos ticked");
  await win.locator('[data-ev="0"][data-f="title"]').fill("Sports day");
  await win.locator('[data-ev="0"][data-f="className"]').fill("3A");
  await win.locator("#i-go").click();
  await expect(win.getByText("Import finished: 30 photos").first()).toBeVisible({ timeout: 60_000 });
  expect(checkLibrary(lib, card)).toBe(30);
  expect(snapshot(card), "the card is left exactly as it was").toEqual(before);

  // The same card comes back: nothing new is offered, and even importing it
  // all on purpose copies nothing a second time.
  await move(card, away);
  await expect.poll(async () => ((await call(win, "volumes")) as unknown[]).length, { timeout: 20_000 }).toBe(0);
  // The app looks for cards every few seconds: give it time to see it's gone.
  await new Promise((r) => setTimeout(r, 8000));
  await move(away, card);
  await expect(win.locator("#i-dev")).toBeVisible({ timeout: 30_000 });
  await win.locator("#i-dev").click();
  await expect(win.locator("#imp")).toContainText("30 imported before (left out)", { timeout: 60_000 });
  await expect(win.locator("#i-go")).toBeDisabled();
  await win.screenshot({ path: test.info().outputPath("card-again.png") });
  const again = await startImport(win, path.join(card, "DCIM"));
  await expect.poll(async () => (await jobOf(win, again.job))?.state, { timeout: 60_000 }).toBe("done");
  expect(checkLibrary(lib, card)).toBe(30);
  expect(snapshot(card)).toEqual(before);
  expect(errors).toEqual([]);
  await app.close();
});

test("closing the app in the middle of an import leaves no half photos, and the next start finishes it", async () => {
  test.setTimeout(300_000);
  const { lib, volumes, userData } = setup();
  const card = path.join(volumes, "CARD2");
  await makeCard(path.join(card, "DCIM"), 250);
  const before = snapshot(card);
  let { app, win } = await launch(userData, volumes);
  const { job } = await startImport(win, path.join(card, "DCIM"));
  await expect.poll(async () => (await jobOf(win, job))?.done ?? 0, { timeout: 60_000, intervals: [50] }).toBeGreaterThanOrEqual(8);
  // Killed, not closed nicely: like a crash or the power going.
  const done = (await jobOf(win, job))!.done;
  app.process().kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 1000));
  expect(done).toBeLessThan(250);

  ({ app, win } = await launch(userData, volumes));
  await expect.poll(async () => (await jobOf(win, job))?.state, { timeout: 120_000 }).toBe("done");
  expect(checkLibrary(lib, card)).toBe(250);
  expect(snapshot(card)).toEqual(before);
  // The import's summary counts every photo once.
  const sum = (await call(win, "importSummary", (await jobOf(win, job))!.importId)) as { copied: number };
  expect(sum.copied).toBeLessThanOrEqual(250);
  await app.close();
});

test("pulling the card out mid-import waits for it, then carries on where it stopped", async () => {
  test.setTimeout(300_000);
  const { base, lib, volumes, userData } = setup();
  const card = path.join(volumes, "CARD3");
  const away = path.join(base, "CARD3-away");
  await makeCard(path.join(card, "DCIM"), 250);
  const before = snapshot(card);
  const { app, win } = await launch(userData, volumes);
  const { job } = await startImport(win, path.join(card, "DCIM"));
  await expect.poll(async () => (await jobOf(win, job))?.done ?? 0, { timeout: 60_000, intervals: [50] }).toBeGreaterThanOrEqual(8);
  await move(card, away);
  await expect.poll(async () => (await jobOf(win, job))?.waitingForCard, { timeout: 30_000 }).toBe(true);
  const stopped = (await jobOf(win, job))!.done;
  expect(stopped).toBeLessThan(250);
  await win.locator('button.nav[data-go="import"]').click();
  await expect(win.locator("#imp")).toContainText("Waiting: plug the card back in to carry on", { timeout: 20_000 });
  await win.screenshot({ path: test.info().outputPath("card-pulled.png") });
  // Nothing half-copied while it waits.
  expect(walk(lib).filter((f) => f.endsWith(".copying"))).toEqual([]);

  await move(away, card);
  await expect.poll(async () => (await jobOf(win, job))?.state, { timeout: 60_000 }).toBe("done");
  expect(checkLibrary(lib, card)).toBe(250);
  expect(snapshot(card)).toEqual(before);
  await app.close();
});

test("Pause stops copying at once and Resume carries on where it stopped", async () => {
  test.setTimeout(300_000);
  const { lib, volumes, userData } = setup();
  const card = path.join(volumes, "CARD4");
  await makeCard(path.join(card, "DCIM"), 250);
  const { app, win } = await launch(userData, volumes);
  // B-57: an import that starts while the Import tab is open (from a card,
  // a link or after a restart) shows up there with its progress.
  await win.locator('button.nav[data-go="import"]').click();
  await expect(win.locator("#drop")).toBeVisible();
  const { job } = await startImport(win, path.join(card, "DCIM"));
  await expect.poll(async () => (await jobOf(win, job))?.done ?? 0, { timeout: 60_000, intervals: [50] }).toBeGreaterThanOrEqual(5);
  await call(win, "set", "paused", true);
  // At most the photo being copied finishes.
  await new Promise((r) => setTimeout(r, 1000));
  const atPause = (await jobOf(win, job))!;
  expect(atPause.done).toBeLessThan(250);
  // B-56: before 0.10 Pause stopped only sending, never an import.
  expect(atPause.paused).toBe(true);
  await new Promise((r) => setTimeout(r, 3000));
  expect((await jobOf(win, job))!.done, "nothing copied while paused").toBe(atPause.done);
  await expect(win.locator("#imp")).toContainText("Paused: press Resume to carry on", { timeout: 20_000 });
  await win.screenshot({ path: test.info().outputPath("import-paused.png") });

  // Resume: it carries on straight away (not at the next minute's check).
  const t0 = Date.now();
  await call(win, "set", "paused", false);
  await expect.poll(async () => (await jobOf(win, job))?.state, { timeout: 40_000 }).toBe("done");
  expect(Date.now() - t0).toBeLessThan(40_000);
  expect(checkLibrary(lib, card)).toBe(250);
  expect(existsSync(card)).toBe(true);
  await app.close();
});

test("the library drive unplugged mid-import: a clear note, nothing copied anywhere else, and it carries on when it's back", async () => {
  test.setTimeout(300_000);
  // Windows won't let a folder the app is watching be moved away, so the
  // stand-in for unplugging doesn't work there; the app code is the same.
  test.skip(process.platform === "win32", "a watched folder can't be moved on Windows");
  const { base, lib, volumes, userData } = setup();
  const card = path.join(volumes, "CARD5");
  await makeCard(path.join(card, "DCIM"), 250);
  const { app, win } = await launch(userData, volumes);
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  const { job } = await startImport(win, path.join(card, "DCIM"));
  await expect.poll(async () => (await jobOf(win, job))?.done ?? 0, { timeout: 60_000, intervals: [50] }).toBeGreaterThanOrEqual(8);
  const away = path.join(base, "Photos-unplugged");
  await move(lib, away);
  await win.locator('button.nav[data-go="import"]').click();
  await expect(win.locator("#imp")).toContainText("the library drive isn't connected", { timeout: 30_000 });
  await win.screenshot({ path: test.info().outputPath("library-unplugged.png") });
  // B-63: the import never makes a new, empty library where the drive was.
  await new Promise((r) => setTimeout(r, 3000));
  expect(existsSync(lib), "no new library folder made in the drive's place").toBe(false);
  expect((await jobOf(win, job))!.done).toBeLessThan(250);
  await move(away, lib);
  await expect.poll(async () => (await jobOf(win, job))?.state, { timeout: 90_000 }).toBe("done");
  expect(checkLibrary(lib, card)).toBe(250);
  // The app watches the drive again: a photo added now is noticed.
  await expect.poll(async () => (await call(win, "countPhotos", {})) as number, { timeout: 60_000 }).toBe(250);
  const extra = path.join(lib, "2026-2027", "Term 1", "2026-10-13 Trip", "IMG_9000.jpg");
  mkdirSync(path.dirname(extra), { recursive: true });
  writeFileSync(extra, await sharp({ create: { width: 320, height: 240, channels: 3, background: "#3a8" } }).jpeg().toBuffer());
  await expect.poll(async () => (await call(win, "countPhotos", {})) as number, { timeout: 30_000 }).toBe(251);
  expect(errors).toEqual([]);
  await app.close();
});

// A real full disk and a real read-only drive: a small RAM disk as the
// library (Linux, where the test machine lets us make one).
const canMount = (() => {
  if (process.platform !== "linux") return false;
  try {
    execFileSync("sudo", ["-n", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("a full library drive and a read-only one: a clear note, no crash, nothing half-written", async () => {
  test.skip(!canMount, "needs a small RAM disk (Linux with sudo)");
  test.setTimeout(300_000);
  const { lib, volumes, userData } = setup();
  execFileSync("sudo", ["-n", "mount", "-t", "tmpfs", "-o", `size=6m,mode=0777`, "tmpfs", lib]);
  try {
    const card = path.join(volumes, "CARD6");
    await makeCard(path.join(card, "DCIM"), 20);
    const cardSize = walk(card).reduce((n, f) => n + statSync(f).size, 0);
    expect(cardSize, "the card holds more than the drive").toBeGreaterThan(7e6);
    const { app, win } = await launch(userData, volumes);
    const errors: string[] = [];
    win.on("pageerror", (e) => errors.push(e.message));
    await win.locator('button.nav[data-go="import"]').click();
    const { job } = await startImport(win, path.join(card, "DCIM"));
    await expect.poll(async () => (await jobOf(win, job))?.state, { timeout: 60_000 }).toBe("problem");
    const j = (await jobOf(win, job)) as Job & { error: string };
    expect(j.error).toBe("disk-full");
    expect(j.done, "stopped part way").toBeLessThan(20);
    await expect(win.locator("#imp")).toContainText("the library drive is full", { timeout: 20_000 });
    await win.screenshot({ path: test.info().outputPath("disk-full.png") });
    // Every photo on the drive is whole (the same bytes as on the card), and no half copy.
    const want = new Set(walk(card).map(sha));
    const there = walk(lib).filter((f) => /\.jpe?g$/i.test(f));
    expect(there.length).toBeGreaterThan(0);
    for (const f of there) expect(want.has(sha(f)), `${f} is whole`).toBe(true);
    expect(walk(lib).filter((f) => f.endsWith(".copying"))).toEqual([]);

    // Read-only now (a locked drive): the same, with its own note.
    execFileSync("sudo", ["-n", "mount", "-o", "remount,ro,size=40m", lib]);
    await win.locator("[data-retry]").click();
    await expect.poll(async () => ((await jobOf(win, job)) as Job & { error: string })?.error, { timeout: 30_000 }).toBe("read-only");
    await expect(win.locator("#imp")).toContainText("can't be written to", { timeout: 20_000 });
    // Space made and writable again: Try again finishes, each photo once.
    execFileSync("sudo", ["-n", "mount", "-o", "remount,rw,size=40m", lib]);
    await win.locator("[data-retry]").click();
    await expect.poll(async () => (await jobOf(win, job))?.state, { timeout: 60_000 }).toBe("done");
    expect(checkLibrary(lib, card)).toBe(20);
    expect(errors).toEqual([]);
    await app.close();
  } finally {
    execFileSync("sudo", ["-n", "umount", "-l", lib]);
  }
});
