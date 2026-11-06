import { _electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { noPostPhoto } from "../src/core/privacy";

// Release 0.9: faces and people, on real faces. Uses the freely licensed
// stand-in photos of the face test (bench/faces/fetch.mjs, kept in GitHub's
// cache, never in the repository): FACE_PHOTOS=<folder> with one folder per
// person. The whole Mac app runs: import, face finding, naming a few faces,
// then the matching that follows.
//   B-07  names survive a full face re-scan
//   B-12  names survive the photos being imported again from a moved folder
//   B-13  a student is never suggested twice in one photo
//   B-15  tiny and blurred faces are never named
//   B-16  an adult (a teacher) and strangers are never named as students
const root = path.join(__dirname, "..");
const photos = process.env.FACE_PHOTOS;
test.skip(!photos || !existsSync(photos), "needs the stand-in face photos (FACE_PHOTOS)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };
type Face = { id: number; photo: string; status: string; student_id: string | null; suggest_id: string | null; auto: number; w: number };

const people = () =>
  readdirSync(photos!, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "groups")
    .map((d) => ({ name: d.name, files: readdirSync(path.join(photos!, d.name)).filter((f) => f.endsWith(".jpg")).sort() }))
    .filter((p) => p.files.length >= 9)
    .sort((a, b) => a.name.localeCompare(b.name));

async function launch(lib: string, userData: string): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  return { app, win };
}

test("real faces: names stay, one name per photo, no tiny, blurred, adult or stranger faces named", async () => {
  test.setTimeout(900_000);
  const list = people();
  expect(list.length, "people with enough photos").toBeGreaterThanOrEqual(6);
  const [a, b, c, teacher, stranger1, stranger2] = list;
  const students = [a, b, c];

  // The library: one event, class 5A. Six photos of each student, five of
  // the teacher, four of each stranger; then made-up photos with one tiny
  // or one blurred face of student A.
  const base = mkdtempSync(path.join(tmpdir(), "hub-faces-"));
  const lib = path.join(base, "Photos");
  const event = path.join(lib, "2026-2027", "Term 1", "2026-11-01 Science day", "5A");
  mkdirSync(event, { recursive: true });
  const put = (p: { name: string; files: string[] }, n: number, from = 0) =>
    p.files.slice(from, from + n).forEach((f) => cpSync(path.join(photos!, p.name, f), path.join(event, `${p.name}-${f}`)));
  for (const s of students) put(s, 6);
  put(teacher, 5);
  put(stranger1, 4);
  put(stranger2, 4);
  const bg = { r: 120, g: 130, b: 140 };
  for (let i = 0; i < 3; i++) {
    const src = path.join(photos!, a.name, a.files[6 + i]);
    // A crowd shot from far away: the face is a few pixels across.
    const small = await sharp(src).rotate().resize(70, 70, { fit: "inside" }).toBuffer();
    await sharp({ create: { width: 1600, height: 1000, channels: 3, background: bg } }).composite([{ input: small, left: 700 + i * 40, top: 300 }]).jpeg().toFile(path.join(event, `tiny-${i}.jpg`));
    // Out of focus.
    const soft = await sharp(src).rotate().resize(900, 900, { fit: "inside" }).blur(14).toBuffer();
    await sharp({ create: { width: 1600, height: 1200, channels: 3, background: bg } }).composite([{ input: soft, left: 350, top: 100 }]).jpeg().toFile(path.join(event, `blur-${i}.jpg`));
  }
  const total = readdirSync(event).length;

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: true, sendMode: "picked" }));
  const dbFile = path.join(userData, "library.db");
  const read = <T>(sql: string, ...args: (string | number)[]) => {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      return db.prepare(sql).all(...args) as T[];
    } finally {
      db.close();
    }
  };
  const faces = () => read<Face>("select f.id, p.name as photo, f.status, f.student_id, f.suggest_id, f.auto, f.w from faces f join photos p on p.id = f.photo_id where p.missing = 0 and f.w > 0");
  const scanned = async () => {
    await expect
      .poll(
        () =>
          existsSync(dbFile)
            ? read<{ n: number; open: number }>("select count(*) as n, coalesce(sum(faces_scanned = 0 and dup_of is null and pair_of is null), 0) as open from photos where missing = 0")[0]
            : { n: 0, open: 1 },
        { timeout: Number(process.env.FACE_WAIT ?? 600_000), intervals: [2000] },
      )
      .toEqual({ n: total, open: 0 });
    // The matching that follows a scan settles.
    let last = "";
    await expect
      .poll(() => {
        const now = JSON.stringify(faces().map((f) => [f.id, f.status, f.student_id, f.suggest_id]));
        const same = now === last;
        last = now;
        return same;
      }, { timeout: 120_000, intervals: [3000] })
      .toBe(true);
  };

  let { app, win } = await launch(lib, userData);
  const call = async <T = unknown>(w: Page, f: string, ...args: unknown[]) => {
    const r = await w.evaluate(([f, args]) => (window as unknown as Hub).hub.call(f as string, ...(args as unknown[])), [f, args] as const);
    expect(r.ok, `${f}: ${JSON.stringify(r)}`).toBe(true);
    return r.value as T;
  };
  const ids: Record<string, string> = {};
  for (const s of students) ids[s.name] = await call<string>(win, "addStudent", { id: `S-${s.name}`.slice(0, 40), name_en: s.name, name_ar: "", class_name: "5A" });
  ids[teacher.name] = await call<string>(win, "addStudent", { id: `T-${teacher.name}`.slice(0, 40), name_en: teacher.name, name_ar: "", class_name: "", kind: "teacher" });
  await scanned();

  // Name two faces of each person, the way a teacher would: the biggest face
  // in two of their photos.
  const biggest = (photo: string) => faces().filter((f) => f.photo === photo).sort((x, y) => y.w - x.w)[0];
  for (const p of [...students, teacher]) {
    const picked = p.files.slice(0, 2).map((f) => biggest(`${p.name}-${f}`)).filter(Boolean);
    expect(picked.length, `faces found for ${p.name}`).toBe(2);
    test.info().annotations.push({ type: "named by hand", description: `${p.name}: ${JSON.stringify(picked.map((f) => [f.photo, f.id, +f.w.toFixed(3)]))}` });
    await call(win, "confirmFaces", picked.map((f) => f.id), ids[p.name]);
    const after = faces().filter((f) => picked.some((x) => x.id === f.id));
    console.log(`named by hand ${p.name}: ${JSON.stringify(picked.map((f) => [f.photo, f.id, f.status, f.student_id]))} -> ${JSON.stringify(after.map((f) => [f.id, f.status, f.student_id, f.auto]))}`);
    expect(after.every((f) => f.student_id === ids[p.name] && f.auto === 0), `hand names for ${p.name} kept`).toBe(true);
  }
  await scanned();

  const studentIds = new Set(students.map((s) => ids[s.name]));
  const check = (when: string) => {
    const all = faces();
    // B-13: nobody twice in one photo (named or suggested).
    const seen = new Map<string, number>();
    for (const f of all) {
      const who = f.student_id ?? (f.status === "suggested" ? f.suggest_id : null);
      if (!who || !["confirmed", "manual", "suggested"].includes(f.status)) continue;
      const k = `${f.photo}|${who}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k), `${when}: someone twice in a photo`).toEqual([]);
    // B-15: tiny and blurred faces get no name and no suggestion.
    const soft = all.filter((f) => /^(tiny|blur)-/.test(f.photo) && (f.student_id || f.suggest_id));
    expect(soft.map((f) => `${f.photo}: ${f.student_id ?? f.suggest_id}`), `${when}: tiny or blurred face named`).toEqual([]);
    // B-16: strangers are never named; the teacher is never named as a student.
    // News photos often show other people too: in each single photo only the
    // biggest face is the person the folder is about.
    const main = new Map<string, number>();
    for (const f of all) if (!main.has(f.photo) || all.find((x) => x.id === main.get(f.photo))!.w < f.w) main.set(f.photo, f.id);
    const wrong = all.filter((f) => main.get(f.photo) === f.id).filter((f) => {
      const who = f.student_id ?? (f.status === "suggested" ? f.suggest_id : null);
      if (!who) return false;
      const strangerPhoto = f.photo.startsWith(`${stranger1.name}-`) || f.photo.startsWith(`${stranger2.name}-`);
      const teacherPhoto = f.photo.startsWith(`${teacher.name}-`);
      return (strangerPhoto && f.student_id) || (teacherPhoto && studentIds.has(who));
    });
    const detail = [...new Set(wrong.map((f) => f.photo))].map((ph) => `${ph}: ${JSON.stringify(all.filter((x) => x.photo === ph).map((x) => [x.id, +x.w.toFixed(3), x.status, x.student_id, x.suggest_id, x.auto]))}`).join("\n");
    expect(wrong.map((f) => `${f.photo}: ${f.student_id ?? f.suggest_id}`), `${when}: stranger or teacher named as a student\n${detail}`).toEqual([]);
  };
  check("after naming");
  // The names people gave by hand, by file name.
  const given = () => faces().filter((f) => f.status === "confirmed" && f.auto === 0 && f.student_id).map((f) => `${f.photo}|${f.student_id}`).sort();
  const before = given();
  expect(before).toHaveLength(8);
  // Matching found more of the named people (more than the 8 named by hand).
  const found = faces().filter((f) => f.student_id || (f.status === "suggested" && f.suggest_id)).length;
  test.info().annotations.push({ type: "faces", description: `named or suggested after naming 8: ${found}` });
  expect(found).toBeGreaterThan(8);

  // Privacy (B-54): student C can't appear. Every photo of C where a face
  // was found is kept off the website (named or a likely match), and the
  // teacher's and strangers' photos are not.
  await call(win, "setCanPost", ids[c.name], false);
  const blocked = new Set(read<{ name: string }>(`select p.name from photos p where p.missing = 0 and ${noPostPhoto("p")}`).map((r) => r.name));
  const withFace = new Set(faces().filter((f) => f.status !== "background").map((f) => f.photo));
  const ofC = c.files.slice(0, 6).map((f) => `${c.name}-${f}`).filter((n) => withFace.has(n));
  const caught = ofC.filter((n) => blocked.has(n));
  test.info().annotations.push({ type: "privacy", description: `photos of a student who can't appear kept off the website: ${caught.length} of ${ofC.length}` });
  // Kept off by mistake (a look-alike suggested as C): safe, but counted.
  test.info().annotations.push({ type: "privacy", description: `other photos kept off too: ${[...blocked].filter((n) => !n.startsWith(`${c.name}-`)).length}` });
  expect(caught.length, `photos of the student who can't appear that are caught (${caught.length}/${ofC.length})`).toBe(ofC.length);
  await call(win, "setCanPost", ids[c.name], true);

  // B-07: the whole library is scanned for faces again (as when the new
  // recogniser arrives). Every name given by hand is still there.
  await app.close();
  {
    const db = new DatabaseSync(dbFile);
    db.exec("update photos set faces_scanned = 0 where missing = 0");
    db.close();
  }
  ({ app, win } = await launch(lib, userData));
  await scanned();
  expect(given(), "names after a full re-scan").toEqual(before);
  check("after a re-scan");

  // B-12: the event folder is renamed while the app is closed, so every
  // photo is found again at a new place. The names follow the photos.
  await app.close();
  renameSync(path.dirname(event), path.join(path.dirname(path.dirname(event)), "2026-11-01 Science fair"));
  ({ app, win } = await launch(lib, userData));
  await scanned();
  expect(given(), "names after the folder moved").toEqual(before);
  check("after the folder moved");
  await win.screenshot({ path: test.info().outputPath("faces-real.png") });
  await app.close();
});
