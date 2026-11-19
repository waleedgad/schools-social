import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { encryptLibrary, isPlainLibrary, openDb, opensWith, backupLibrary, LibraryLockedError } from "./db";
import { allowed, appState, fromServer, keyOf, LicenceStore, merge, type Licence } from "./licence";

const key = Buffer.alloc(32, 9);
const answer = (over: Record<string, unknown> = {}) => ({
  state: "active",
  key: key.toString("base64"),
  valid_until: new Date(Date.now() + 10 * 86400_000).toISOString(),
  paid_until: "2027-01-01",
  read_only_left: 0,
  days_left: 40,
  forced: false,
  plan: { name_en: "Standard", name_ar: "قياسية" },
  contact: "WhatsApp",
  ...over,
});
const lic = (over: Record<string, unknown> = {}) => fromServer("school-1", answer(over)) as Licence;

test("licence: the server's state, and 10 days offline then read-only", () => {
  assert.equal(appState(null).state, "none");
  assert.equal(appState(lic()).state, "active");
  assert.equal(appState(lic({ state: "read_only" })).state, "read_only");
  assert.equal(appState(lic({ state: "blocked" })).state, "blocked");
  const l = lic();
  assert.equal(appState(l, Date.now() + 9 * 86400_000).state, "active");
  const late = appState(l, Date.now() + 10 * 86400_000 + 60_000);
  assert.deepEqual([late.state, late.offline], ["read_only", true]);
});

test("licence: a server answer can't stretch the offline days, and a blocked school gets no key", () => {
  const l = lic({ valid_until: new Date(Date.now() + 400 * 86400_000).toISOString() });
  assert.ok(Date.parse(l.validUntil) <= Date.now() + 10 * 86400_000 + 1000);
  const b = lic({ state: "blocked", key: key.toString("base64") });
  assert.equal(b.key, null);
  assert.equal(keyOf(b), null);
  assert.deepEqual(fromServer("s", { error: "not-registered" }), { error: "not-registered" });
  assert.deepEqual(fromServer("s", { state: "odd" }), { error: "bad-answer" });
  // A short or odd key is never used.
  assert.equal(lic({ key: Buffer.alloc(8).toString("base64") }).key, null);
});

test("licence: blocked removes the key from this computer; another school never reuses it", () => {
  const old = lic();
  assert.equal(merge(old, lic({ state: "blocked" })).key, null);
  assert.equal(merge(old, lic({ key: null })).key, old.key);
  const other = fromServer("school-2", answer({ key: null })) as Licence;
  assert.equal(merge(old, other).key, null);
});

test("licence: kept locked with the computer's key store", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lic-"));
  const file = path.join(dir, "licence.bin");
  const protect = { available: () => true, encrypt: (s: string) => Buffer.from(Buffer.from(s).map((b) => b ^ 0x5a)), decrypt: (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a)).toString() };
  const store = new LicenceStore(file, protect);
  assert.equal(store.read(), null);
  store.write(lic());
  assert.ok(!readFileSync(file).toString().includes(key.toString("base64")));
  assert.equal(store.read()?.key, key.toString("base64"));
  writeFileSync(file, "nonsense");
  assert.equal(store.read(), null);
  store.clear();
  assert.equal(store.read(), null);
});

test("licence: read-only stops import, AI picks, face matching and new posts; blocked allows only signing in", () => {
  for (const f of ["importStart", "best", "confirmFaces", "newPost", "sendNow"]) assert.equal(allowed(f, "read_only"), false, f);
  for (const f of ["photos", "photo", "people", "person", "students", "search", "state"]) assert.equal(allowed(f, "read_only"), true, f);
  for (const f of ["photos", "people", "students", "importStart"]) assert.equal(allowed(f, "blocked"), false, f);
  for (const f of ["state", "signIn", "signOut", "checkLicence"]) assert.equal(allowed(f, "blocked"), true, f);
  assert.equal(allowed("photos", "none"), false);
  assert.equal(allowed("anything", "active"), true);
});

test("encrypted library: a plain library is moved once, after a backup, and nothing is lost", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "enc-"));
  const file = path.join(dir, "library.db");
  const db = openDb(file);
  db.prepare("insert into students (id, name_en, added_at) values (?, ?, ?)").run("S1", "Secret Student", 1);
  db.prepare("insert into photos (path, name, ext, size, mtime, added_at) values (?, ?, ?, ?, ?, ?)").run("/a.jpg", "a.jpg", "jpg", 1, 1, 1);
  db.prepare("insert into faces (photo_id, x, y, w, h, embedding, student_id) values (1, 0, 0, 1, 1, ?, 'S1')").run(new Uint8Array([1, 2, 3, 4]));
  db.close();
  assert.equal(isPlainLibrary(file), true);
  assert.equal(encryptLibrary(file, key, path.join(dir, "backups", "before-encryption")), true);
  assert.equal(isPlainLibrary(file), false);
  assert.ok(!readFileSync(file).includes(Buffer.from("Secret Student")));
  // The backup is encrypted with the same key too.
  const backup = path.join(dir, "backups", "before-encryption", "library.db");
  assert.equal(isPlainLibrary(backup), false);
  assert.equal(opensWith(backup, key), true);
  // Only the right key opens it.
  assert.throws(() => openDb(file), LibraryLockedError);
  assert.throws(() => openDb(file, Buffer.alloc(32, 1)), LibraryLockedError);
  const back = openDb(file, key);
  assert.equal((back.prepare("select name_en from students where id = 'S1'").get() as { name_en: string }).name_en, "Secret Student");
  const face = back.prepare("select embedding, student_id from faces").get() as { embedding: Uint8Array; student_id: string };
  assert.deepEqual([...face.embedding], [1, 2, 3, 4]);
  // Writing keeps it encrypted (the journal too).
  back.prepare("insert into students (id, name_en, added_at) values (?, ?, ?)").run("S2", "Second Secret", 2);
  assert.ok(!readFileSync(file).includes(Buffer.from("Second Secret")));
  back.close();
  // A second run does nothing.
  assert.equal(encryptLibrary(file, key, path.join(dir, "backups", "again")), false);
});

test("encrypted library: the backup before an update is encrypted too", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "encb-"));
  const file = path.join(dir, "library.db");
  const db = openDb(file, key);
  db.prepare("insert into students (id, name_en, added_at) values (?, ?, ?)").run("S9", "Backup Student", 1);
  db.close();
  const target = path.join(dir, "copy.db");
  backupLibrary(file, key, target);
  assert.equal(isPlainLibrary(target), false);
  assert.ok(!readFileSync(target).includes(Buffer.from("Backup Student")));
  const c = openDb(target, key);
  assert.equal((c.prepare("select count(*) n from students").get() as { n: number }).n, 1);
  c.close();
});
