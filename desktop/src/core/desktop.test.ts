import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import exifr from "exifr";
import sharp from "sharp";
import { eventFolder, eventFromPath, isPhoto, schoolYear, term } from "./library";
import { prepare } from "./photo";
import { UploadQueue } from "./queue";
import { importFolder, LibrarySync } from "./sync";

const temp = () => mkdtempSync(path.join(tmpdir(), "hub-"));

// A stand-in for Supabase that records what the app sends.
function fakeSupabase(options: { offlineCalls?: number } = {}) {
  let offline = options.offlineCalls ?? 0;
  const uploads: string[] = [];
  const rows: Record<string, Record<string, unknown>[]> = { photos: [], events: [] };
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    let inserted: Record<string, unknown> | null = null;
    const result = () => {
      if (inserted) return { data: inserted, error: null };
      const found = rows[table].filter((r) => filters.every(([k, v]) => r[k] === v));
      return { data: found[0] ?? null, error: null };
    };
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push([k, v]), q),
      limit: () => q,
      maybeSingle: async () => result(),
      single: async () => result(),
      insert: (row: Record<string, unknown>) => {
        const dup = table === "photos" && rows.photos.some((r) => r.source_key === row.source_key);
        if (dup) return { ...q, then: (fn: (v: unknown) => void) => fn({ error: { code: "23505", message: "duplicate" } }) };
        inserted = { id: row.id ?? `ev-${rows[table].length + 1}`, ...row };
        rows[table].push(inserted);
        return Object.assign(q, { then: (fn: (v: unknown) => void) => fn({ error: null, data: inserted }) });
      },
    };
    return q;
  };
  const client = {
    from: query,
    storage: {
      from: () => ({
        upload: async (p: string, body: Buffer) => {
          if (offline > 0) {
            offline--;
            return { error: { message: "fetch failed" } };
          }
          assert.ok(body.byteLength > 0);
          uploads.push(p);
          return { error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, uploads, rows };
}

async function photoWithGps(file: string) {
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#4a8" } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "30/1 2/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "31/1 14/1 0/1" } })
    .toFile(file);
}

const until = async (check: () => boolean, ms = 15000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
};

test("folder rules", () => {
  const lib = path.join("/x", "Photos");
  assert.equal(schoolYear(new Date(2026, 9, 20)), "2026-2027");
  assert.equal(schoolYear(new Date(2027, 2, 1)), "2026-2027");
  assert.equal(term(new Date(2026, 9, 20)), "Term 1");
  assert.equal(term(new Date(2027, 0, 10)), "Term 1");
  assert.equal(term(new Date(2027, 3, 10)), "Term 2");
  assert.equal(eventFolder(lib, new Date(2026, 9, 20), 'Science: fair?'), path.join(lib, "2026-2027", "Term 1", "2026-10-20 Science fair"));
  assert.deepEqual(eventFromPath(lib, path.join(lib, "2026-2027", "Term 1", "2026-10-20 معرض العلوم", "a.jpg")), {
    key: "2026-2027/Term 1/2026-10-20 معرض العلوم",
    title: "معرض العلوم",
    date: "2026-10-20",
  });
  assert.equal(eventFromPath(lib, path.join(lib, "a.jpg")), null);
  assert.equal(eventFromPath(lib, path.join(lib, "2026-2027", "Term 1", "a.jpg")), null);
  assert.equal(eventFromPath(lib, path.join(lib, "Sports day", "a.jpg"))?.date, null);
  assert.ok(isPhoto("A.JPG") && !isPhoto("notes.txt") && !isPhoto("._A.jpg"));
});

test("web copies are small and carry no location", async () => {
  const dir = temp();
  const file = path.join(dir, "gps.jpg");
  await photoWithGps(file);
  assert.ok((await exifr.gps(file))?.latitude, "test photo should start with GPS");
  const p = await prepare(file);
  assert.equal(Math.max(p.width, p.height), 2048);
  const meta = await sharp(p.full).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(await exifr.gps(p.full).catch(() => undefined), undefined);
  assert.ok((await sharp(p.thumb).metadata()).width! <= 480);
});

test("import, watch, upload once, retry when offline, back up", async () => {
  const root = temp();
  const library = path.join(root, "Photos");
  const backup = path.join(root, "Backup");
  const card = path.join(root, "card");
  await mkdir(library, { recursive: true });
  await mkdir(path.join(card, "DCIM"), { recursive: true });
  await photoWithGps(path.join(card, "DCIM", "IMG_1.jpg"));
  await copyFile(path.join(card, "DCIM", "IMG_1.jpg"), path.join(card, "DCIM", "IMG_1 copy.jpg")); // same photo twice
  await sharp({ create: { width: 800, height: 600, channels: 3, background: "#a33" } }).png().toFile(path.join(card, "IMG_2.png"));
  await writeFile(path.join(card, "notes.txt"), "not a photo");
  await writeFile(path.join(card, "broken.jpg"), "not really a jpeg");

  const { copied, target } = await importFolder(library, card, "Science fair", new Date(2026, 9, 20, 12));
  assert.equal(copied, 4);
  assert.equal(target, path.join(library, "2026-2027", "Term 1", "2026-10-20 Science fair"));

  const fake = fakeSupabase({ offlineCalls: 1 });
  const queue = new UploadQueue(path.join(root, "state", "queue.json"));
  const sync = new LibrarySync({
    supabase: fake.client,
    queue,
    eventsFile: path.join(root, "state", "events.json"),
    schoolId: "school-1",
    userId: "user-1",
    library,
    backup,
    onChange: () => {},
  });
  // Make the offline retry quick for the test.
  const retry = queue.retryLater.bind(queue);
  queue.retryLater = (job, error) => retry(job, error, Date.now() - 60_000);
  sync.start();
  try {
    await until(() => queue.stats().pending === 0 && queue.stats().failed === 1 && sync.current.length === 0);
  } finally {
    await sync.stop();
  }

  assert.equal(fake.rows.photos.length, 2, "duplicate copy is uploaded once");
  assert.equal(fake.rows.events.length, 1);
  assert.equal(fake.rows.events[0].title, "Science fair");
  assert.equal(fake.rows.events[0].event_date, "2026-10-20");
  assert.ok(fake.rows.photos.every((p) => p.event_id === fake.rows.events[0].id && p.source === "desktop"));
  assert.ok(fake.uploads.every((u) => u.startsWith("school-1/")));
  assert.equal(queue.stats().failed, 1, "the broken file waits for a person");
  assert.ok(existsSync(path.join(backup, "2026-2027", "Term 1", "2026-10-20 Science fair", "IMG_1.jpg")));
  assert.equal(readdirSync(path.join(backup, "2026-2027", "Term 1", "2026-10-20 Science fair")).length, 3);

  // Restart: nothing is sent again.
  const again = new LibrarySync({ supabase: fake.client, queue, eventsFile: path.join(root, "state", "events.json"), schoolId: "school-1", userId: "user-1", library, backup: null, onChange: () => {} });
  again.start();
  await new Promise((r) => setTimeout(r, 4000));
  await again.stop();
  assert.equal(fake.rows.photos.length, 2);
});
