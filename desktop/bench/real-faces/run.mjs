// Face test on the school's OWN photos (on the school's or Waleed's computer).
//
//   bench/real-faces/face-test.sh <test-folder>          (sets everything up)
//   node bench/real-faces/run.mjs <test-folder> [--aura <auraface.onnx>] [--out <dir>]
//
// The test folder (see docs/face-test-guide.md):
//   <test-folder>/
//     class list.xlsx         the school's class list (any file the app imports:
//                             our template, PowerSchool, Classera, Edunation, .csv)
//     Students/<name or ID>/  photos of that student: they are the BIGGEST face
//                             in each photo. A file called "portrait..." is the
//                             school portrait.
//     Staff/<name>/           (optional) the same for teachers and staff
//     Not in list/            (optional) photos of people who are NOT on the list
//                             (parents, visitors, other schools): never to be named
//     Class photos/<class>/   (optional) class or event photos of one class, not
//                             sorted by person; loose files = whole-school events
//
// What it does, with the app's own face code (dist/core/faces.js) and rules:
// for each student a few faces count as "confirmed by staff" (the portrait
// first, then their oldest photos), every other photo is matched like the app
// matches a new photo (against that class and the staff, one person per
// photo, the app's "sure" rule, learning from its own sure names), and the
// result is compared with the folder the photo is in.
//
// Privacy: everything stays on this computer. The printed summary and
// summary.md / summary.json use student codes (class + number), never names
// or file names, so they can be shared. Names, file names, face pictures and
// the stored face descriptions are only in <out>/private/ (delete it after).
import { createRequire } from "node:module";
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "../..");
const F = require(path.join(desktop, "dist/core/faces.js"));
const { source } = require(path.join(desktop, "dist/core/media.js"));
const { takenAt } = require(path.join(desktop, "dist/core/photo.js"));
const { readSheet, parseRows } = require(path.join(desktop, "dist/core/students.js"));
const sharp = require("sharp");
const MODELS = path.join(desktop, "models");

// ---- Settings ----------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const auraArg = flag("--aura");
const outArg = flag("--out");
const ROOT = args[0] ? path.resolve(args[0]) : null;
if (!ROOT || !existsSync(ROOT)) {
  console.error("Usage: node bench/real-faces/run.mjs <test-folder> [--aura auraface.onnx] [--out results-folder]");
  process.exit(2);
}
// AuraFace: given, or the copy the installed app downloaded, or the one
// face-test.sh downloaded. Without it only the older recogniser (SFace) runs,
// which is NOT what the app uses: the numbers would be lower.
const appModels = [
  path.join(os.homedir(), "Library/Application Support/School Social Hub Library/models"),
  path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData/Roaming"), "School Social Hub Library/models"),
  path.join(os.homedir(), ".config/School Social Hub Library/models"),
  path.join(here, ".models"),
];
const auraFile = [auraArg, ...appModels.map((d) => path.join(d, F.AURA_FILE))].find((f) => f && existsSync(f)) ?? null;
const OUT = path.resolve(outArg ?? path.join(ROOT, "face-test-results"));
const PRIV = path.join(OUT, "private");
const KS = (process.env.FACE_TEST_K ?? "1,3,5").split(",").map(Number);
const MAIN_K = KS.includes(3) ? 3 : KS[0];
const PHOTO = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i;

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .replace(/[ً-ْـ]/g, "") // Arabic marks and stretching
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

async function walk(dir) {
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith(".")) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...(await walk(p)));
    else if (PHOTO.test(d.name)) out.push(p);
  }
  return out.sort();
}
const childDirs = async (dir) =>
  existsSync(dir) ? (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort() : [];
// a top folder by any of its usual names (English or Arabic)
async function top(...names) {
  const all = await childDirs(ROOT);
  const hit = all.find((d) => names.some((n) => norm(d) === norm(n)));
  return hit ? path.join(ROOT, hit) : null;
}

// ---- 1. The class list -------------------------------------------------------
const listFile = (await readdir(ROOT)).filter((f) => /\.(xlsx|csv)$/i.test(f) && !f.startsWith("~$")).sort()[0];
if (!listFile) {
  console.error(`No class list (.xlsx or .csv) found directly inside ${ROOT}`);
  process.exit(2);
}
const parsed = parseRows(await readSheet(path.join(ROOT, listFile)));
const people = new Map(); // id -> { id, names, className, gender, kind }
for (const s of parsed.students) people.set(s.id, { id: s.id, names: [s.name_en, s.name_ar].filter(Boolean), className: s.class_name, gender: s.gender, kind: "student" });
if (!people.size) {
  console.error(`The class list ${listFile} has no students the app can read (it needs a name column, and a class column).`);
  process.exit(2);
}
const lookup = new Map();
for (const p of people.values()) for (const k of [p.id, ...p.names]) lookup.set(norm(k), p.id);

const studentsDir = await top("Students", "Student", "الطلاب", "طلاب");
const staffDir = await top("Staff", "Teachers", "المعلمين", "المعلمون", "الموظفين");
const strangersDir = await top("Not in list", "Not on list", "Not in the list", "Strangers", "Visitors", "ليسوا في القائمة", "غير موجودين");
const classDir = await top("Class photos", "Class photo", "Events", "صور الفصول", "صور الفصل");
if (!studentsDir) {
  console.error(`No "Students" folder inside ${ROOT}`);
  process.exit(2);
}
const unmatched = [];
const folders = []; // { id, dir }
for (const d of await childDirs(studentsDir)) {
  const id = lookup.get(norm(d));
  if (id) folders.push({ id, dir: path.join(studentsDir, d) });
  else unmatched.push(d);
}
let staffN = 0;
for (const d of await childDirs(staffDir)) {
  const id = `staff:${++staffN}`;
  people.set(id, { id, names: [d], className: null, gender: null, kind: "staff" });
  folders.push({ id, dir: path.join(staffDir, d) });
}
// Codes for the shareable report: class + number (staff: T + number).
const code = new Map();
{
  const byClass = new Map();
  for (const p of [...people.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const c = p.kind === "staff" ? "T" : p.className ?? "?";
    byClass.set(c, (byClass.get(c) ?? 0) + 1);
    code.set(p.id, p.kind === "staff" ? `T${byClass.get(c)}` : `${c}-${String(byClass.get(c)).padStart(2, "0")}`);
  }
}
const nameOf = (id) => people.get(id)?.names[0] ?? id;

// ---- 2. Find and describe every face (kept between runs) -------------------
const fingerprint = createHash("sha1")
  .update([F.findFaces, F.align, F.faceProblem, F.faceSharpness, F.decode, F.loadModels, F.shrinkForAlign, F.secondLook, F.cut].map(String).join("\n") + (auraFile ? "both" : "sface"))
  .digest("hex");
await mkdir(PRIV, { recursive: true });
const cacheFile = path.join(PRIV, "faces-cache.json");
const cache = new Map();
if (existsSync(cacheFile)) {
  const c = JSON.parse(await readFile(cacheFile, "utf8"));
  if (c.fingerprint === fingerprint) for (const [k, v] of Object.entries(c.photos)) cache.set(k, v);
}
const toB64 = (e) => Buffer.from(e.buffer, e.byteOffset, e.byteLength).toString("base64");
const fromB64 = (s) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
};
async function saveCache() {
  await writeFile(cacheFile, JSON.stringify({ fingerprint, photos: Object.fromEntries(cache) }));
}
let recogniser = auraFile ? "both" : "sface";
async function read(file) {
  const st = await stat(file);
  const key = `${path.relative(ROOT, file)}|${st.size}|${Math.round(st.mtimeMs)}`;
  let hit = cache.get(key);
  if (!hit) {
    let faces = [], width = null, height = null, at = null, error = null;
    try {
      const input = await source(file);
      const meta = await sharp(input, { failOn: "none" }).rotate().metadata();
      const turned = (meta.orientation ?? 1) >= 5;
      width = turned ? meta.height : meta.width;
      height = turned ? meta.width : meta.height;
      const found = await F.findFaces(MODELS, input, { aura: auraFile, eyes: false });
      if (found.recogniser) recogniser = found.recogniser;
      faces = found.map((f) => ({ box: f.box, usable: f.usable, why: f.why, sharpness: f.sharpness, px: f.px ?? F.facePx(f.box[2], width, height), e: toB64(f.embedding) }));
      at = (await takenAt(file))?.toISOString() ?? null;
    } catch (e) {
      error = String(e instanceof Error ? e.message : e).slice(0, 200);
    }
    hit = { faces, width, height, at, error, recogniser };
    cache.set(key, hit);
    if (++newlyRead % 50 === 0) {
      await saveCache();
      console.error(`  ${newlyRead} photos read (${((Date.now() - t0) / 60000).toFixed(0)} min)`);
    }
  }
  if (hit.recogniser) recogniser = hit.recogniser;
  return { file, ...hit, faces: hit.faces.map((f) => ({ ...f, e: fromB64(f.e) })) };
}
let newlyRead = 0;
const t0 = Date.now();

const photos = []; // { file, faces, at, owner (truth id|null), kind: 'student'|'stranger'|'class', className, portrait }
const allFiles = [];
for (const f of folders) for (const file of await walk(f.dir)) allFiles.push({ file, kind: "student", owner: f.id });
if (strangersDir) for (const file of await walk(strangersDir)) allFiles.push({ file, kind: "stranger", owner: null });
if (classDir) {
  const classes = new Set([...people.values()].map((p) => p.className).filter(Boolean));
  for (const file of await walk(classDir)) {
    const first = path.relative(classDir, file).split(path.sep)[0];
    const cls = [...classes].find((c) => norm(c) === norm(first)) ?? null;
    allFiles.push({ file, kind: "class", owner: null, className: cls });
  }
}
console.error(`Reading ${allFiles.length} photos (${cache.size} known from the last run)${auraFile ? "" : " — WARNING: AuraFace not found, using the older recogniser only"}`);
for (const x of allFiles) {
  const r = await read(x.file);
  photos.push({ ...x, ...r, className: x.kind === "student" ? people.get(x.owner)?.className ?? null : x.className ?? null, portrait: /^portrait|^بورتريه|^صورة شخصية/i.test(path.basename(x.file)) });
}
await saveCache();
const readMinutes = (Date.now() - t0) / 60000;

// The student's face in their own photo: the biggest face, when it is
// clearly the main one (a group shot where two faces are about as big is
// left out: we can't tell which one is the student).
const unclear = [];
for (const p of photos) {
  p.id = photos.indexOf(p);
  if (p.kind !== "student") continue;
  const order = p.faces.map((f, i) => [i, f.box[2] * f.box[3] * (p.width ?? 1) * (p.height ?? 1)]).sort((a, b) => b[1] - a[1]);
  if (!order.length) p.truthFace = -1;
  else if (order[1] && order[1][1] * 1.8 > order[0][1]) {
    p.truthFace = null;
    unclear.push(p);
  } else p.truthFace = order[0][0];
}

// ---- 3. Match like the app ---------------------------------------------------
const R = () => recogniser;
// Confirmed faces for k: portrait first, then the oldest photos.
function confirmed(k) {
  const hand = [], used = new Set();
  const byOwner = new Map();
  for (const p of photos) if (p.kind === "student" && p.truthFace >= 0 && p.truthFace !== null && p.faces[p.truthFace].usable) (byOwner.get(p.owner) ?? byOwner.set(p.owner, []).get(p.owner)).push(p);
  for (const [owner, list] of byOwner) {
    list.sort((a, b) => Number(b.portrait) - Number(a.portrait) || String(a.at ?? "9").localeCompare(String(b.at ?? "9")) || a.file.localeCompare(b.file));
    for (const p of list.slice(0, k)) {
      const who = people.get(owner);
      hand.push({ studentId: owner, embedding: p.faces[p.truthFace].e, className: who.className, kind: who.kind, gender: who.gender, at: p.at, photoId: p.id });
      used.add(p.id);
    }
  }
  return { hand, used };
}
// knownFor in the app: a class's photo is matched against that class and
// the staff; anything else against everyone.
const forClass = (known, cls) => {
  if (!cls) return known;
  const mine = known.filter((k) => k.className === cls || k.kind !== "student");
  return mine.some((k) => k.kind === "student") ? mine : known;
};
function simulate(k, scope) {
  const { hand, used } = confirmed(k);
  const tests = photos.filter((p) => !used.has(p.id) && !(p.kind === "student" && p.truthFace === null));
  const names = new Map(); // photo id -> Map(face -> sid)
  const learned = [];
  const traits = F.traitCentres(hand, hand[0]?.embedding.length ?? 0);
  const fits = (e, sid) => {
    const who = people.get(sid);
    const t = F.guessTraits(e, traits);
    if (who && t.gender && who.gender && t.gender !== who.gender) return false;
    if (who && t.adult === true && who.kind === "student") return false;
    if (who && t.adult === false && who.kind !== "student") return false;
    return true;
  };
  const last = new Map(); // photo id -> matches (last round)
  for (let round = 0; round < 4; round++) {
    let added = 0;
    for (const p of tests) {
      const done = names.get(p.id) ?? new Map();
      const all = [...hand, ...learned.filter((l) => l.photoId !== p.id)];
      const known = scope === "class" ? forClass(all, p.className) : all;
      const embs = p.faces.map((f, i) => (f.usable && !done.has(i) ? f.e : null));
      if (!embs.some(Boolean)) continue;
      const matches = F.assignPhoto(embs, known, R(), new Set(done.values()), (i, sid) => fits(embs[i], sid));
      last.set(p.id, { matches, known });
      matches.forEach((m, i) => {
        if (!m || done.has(i)) return;
        if (F.isSure(m, R()) && F.handAgrees(embs[i], known, m.studentId, R())) {
          done.set(i, m.studentId);
          names.set(p.id, done);
          if (F.learnFrom(F.unscaled(m.score, R()))) {
            const who = people.get(m.studentId);
            learned.push({ studentId: m.studentId, embedding: embs[i], className: who?.className, kind: who?.kind, gender: who?.gender, learned: true, photoId: p.id });
            added++;
          }
        }
      });
    }
    if (!added) break;
  }
  // ---- score
  const t = { k, scope, tests: 0, right: 0, wrong: 0, sugRight: 0, sugWrong: 0, missed: 0, why: {}, strangers: 0, strangerNamed: 0, strangerSuggested: 0, classFaces: 0, classNamed: 0, classSuggested: 0, perClass: {}, perStudent: {}, wrongList: [], missList: [], strangerList: [], classList: [] };
  const bump = (o, key) => (o[key] = (o[key] ?? 0) + 1);
  for (const p of tests) {
    const done = names.get(p.id) ?? new Map();
    const lm = last.get(p.id);
    if (p.kind === "student") {
      const cls = p.className ?? (people.get(p.owner).kind === "staff" ? "Staff" : "?");
      const pc = (t.perClass[cls] ??= { tests: 0, right: 0, wrong: 0, sugRight: 0, missed: 0 });
      const ps = (t.perStudent[p.owner] ??= { tests: 0, right: 0, wrong: 0, missed: 0 });
      t.tests++, pc.tests++, ps.tests++;
      const fi = p.truthFace;
      const face = fi >= 0 ? p.faces[fi] : null;
      const got = fi >= 0 ? done.get(fi) : undefined;
      if (got === p.owner) {
        t.right++, pc.right++, ps.right++;
        continue;
      }
      if (got) {
        t.wrong++, pc.wrong++, ps.wrong++;
        t.wrongList.push({ p, fi, truth: p.owner, named: got });
        continue;
      }
      // not named by itself: was it suggested ("Likely ...")?
      const m = lm?.matches[fi];
      const clear = face && F.clearEnough(face.px, face.sharpness);
      if (m && m.score >= F.SHOW_FROM && clear) {
        if (m.studentId === p.owner) t.sugRight++, pc.sugRight++;
        else t.sugWrong++;
      }
      t.missed++, pc.missed++, ps.missed++;
      let why;
      if (p.error) why = "photo could not be opened";
      else if (!face) why = "no face found in the photo";
      else if (!face.usable) why = `face not usable (${face.why ?? "unclear"})`;
      else {
        const known = lm?.known ?? hand;
        const list = F.ranked(face.e, known, R());
        const own = list.find((c) => c.studentId === p.owner);
        if (!own) why = "student has no confirmed face yet";
        else if (list[0].studentId !== p.owner) why = "first guess is someone else";
        else if (F.unscaled(list[0].score, R()) < F.unscaled(F.SURE, R()) - 1e-9) why = "right person, but not sure enough (score too low)";
        else if (list[0].score - (list[1]?.score ?? 0) < F.SURE_GAP - 1e-9) why = "right person, but too close to the next person";
        else if (m?.studentId !== p.owner) why = "right person, but the name went to another face in the photo (or boy/girl, student/adult guess)";
        else why = "right person, but the confirmed faces alone disagree (learning rule)";
        if (!clear) why += " — small or blurred face";
      }
      bump(t.why, why);
      t.missList.push({ p, fi, truth: p.owner, why, guess: m?.studentId ?? null, score: m?.score ?? null });
    } else if (p.kind === "stranger") {
      p.faces.forEach((f, i) => {
        if (!f.usable) return;
        t.strangers++;
        const got = done.get(i);
        if (got) t.strangerNamed++, t.strangerList.push({ p, fi: i, named: got });
        else {
          const m = lm?.matches[i];
          if (m && m.score >= F.SHOW_FROM && F.clearEnough(f.px, f.sharpness)) t.strangerSuggested++;
        }
      });
    } else {
      p.faces.forEach((f, i) => {
        if (!f.usable) return;
        t.classFaces++;
        const got = done.get(i);
        if (got) t.classNamed++, t.classList.push({ p, fi: i, named: got });
        else {
          const m = lm?.matches[i];
          if (m && m.score >= F.SHOW_FROM && F.clearEnough(f.px, f.sharpness)) t.classSuggested++;
        }
      });
    }
  }
  t.hand = hand.length;
  t.learned = learned.length;
  return t;
}

const runs = [];
for (const k of KS) for (const scope of ["class", "school"]) runs.push(simulate(k, scope));
const main = runs.find((r) => r.k === MAIN_K && r.scope === "class");

// Look-alikes: students whose confirmed faces are close (twins, siblings,
// or just similar). The app asks for these instead of naming by itself.
const lookAlikes = [];
{
  const { hand } = confirmed(Math.max(...KS));
  const by = new Map();
  for (const h of hand) (by.get(h.studentId) ?? by.set(h.studentId, []).get(h.studentId)).push(h.embedding);
  const centres = [...by.entries()].filter(([, l]) => l.length >= 2).map(([id, l]) => {
    const c = new Float32Array(l[0].length);
    for (const e of l) e.forEach((v, i) => (c[i] += v));
    let n = 0;
    for (const v of c) n += v * v;
    n = Math.sqrt(n) || 1;
    return { id, c: c.map((v) => v / n) };
  });
  for (let a = 0; a < centres.length; a++)
    for (let b = a + 1; b < centres.length; b++) {
      const s = F.cosine(centres[a].c, centres[b].c);
      if (s >= 0.42) lookAlikes.push({ a: centres[a].id, b: centres[b].id, s });
    }
  lookAlikes.sort((x, y) => y.s - x.s);
}

// ---- 4. Reports ---------------------------------------------------------------
const studentPhotos = photos.filter((p) => p.kind === "student");
const facesPerPhoto = studentPhotos.length ? studentPhotos.reduce((s, p) => s + p.faces.length, 0) / studentPhotos.length : 0;
const withFolders = new Set(folders.map((f) => f.id));
const listedStudents = [...people.values()].filter((p) => p.kind === "student");
const perStudentPhotos = new Map();
for (const p of studentPhotos) perStudentPhotos.set(p.owner, (perStudentPhotos.get(p.owner) ?? 0) + 1);
const few = [...perStudentPhotos.entries()].filter(([, n]) => n < MAIN_K + 3);

function report(withNames) {
  const who = (id) => (withNames ? `${nameOf(id)} (${code.get(id)})` : code.get(id) ?? "?");
  const where = (p) => (withNames ? path.relative(ROOT, p.file) : `photo #${p.id + 1}`);
  const L = [];
  L.push(`# Face test on the school's own photos${withNames ? " (PRIVATE: has names, keep on this computer)" : ""}`, "");
  L.push(`Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · recogniser: ${recogniser === "both" ? "AuraFace + SFace (as the app)" : "SFace only — AuraFace missing, NOT what the app uses"} · photos read in ${readMinutes.toFixed(0)} min`, "");
  L.push(`## The answer`, "");
  L.push(`With **${MAIN_K} confirmed faces** per student (what staff give in the first days), matching each photo against its class like the app does:`, "");
  L.push(`- **Named by the app itself: ${pct(main.right, main.tests)}** of ${main.tests} student faces (goal: about 95%)`);
  L.push(`- **Named WRONG by itself: ${main.wrong}** (goal: 0)`);
  L.push(`- Shown as "Likely …" for one tap: ${main.sugRight} more right${main.sugWrong ? `, ${main.sugWrong} suggested wrong` : ""} → named or one tap away: ${pct(main.right + main.sugRight, main.tests)}`);
  if (main.strangers) L.push(`- People not on the list: ${main.strangerNamed} of ${main.strangers} faces named as a student (goal: 0)`);
  if (main.classFaces) L.push(`- Class/event photos (no answer key): ${pct(main.classNamed, main.classFaces)} of ${main.classFaces} faces named by itself — check them in private/check.html`);
  L.push("");
  L.push(`## What went in`, "");
  L.push(`- Class list: ${listFile.replace(/.*/, withNames ? listFile : "(the school's file)")}, read as ${parsed.format}: ${listedStudents.length} students in ${new Set(listedStudents.map((p) => p.className)).size} classes`);
  L.push(`- Student folders matched to the list: ${[...withFolders].filter((id) => people.get(id)?.kind === "student").length}${unmatched.length ? ` · **${unmatched.length} folder(s) not found in the list** (left out${withNames ? `: ${unmatched.join(", ")}` : ""})` : ""}${staffN ? ` · staff folders: ${staffN}` : ""}`);
  L.push(`- Photos: ${studentPhotos.length} in student folders (${facesPerPhoto.toFixed(1)} faces each on average), ${photos.filter((p) => p.kind === "stranger").length} of people not on the list, ${photos.filter((p) => p.kind === "class").length} class/event photos`);
  L.push(`- Left out: ${unclear.length} photo(s) where two faces are about the same size (can't tell which is the student), ${photos.filter((p) => p.error).length} that could not be opened`);
  if (few.length) L.push(`- ${few.length} student(s) with fewer than ${MAIN_K + 3} photos: their numbers say little${withNames ? ` (${few.map(([id, n]) => `${nameOf(id)} ${n}`).join(", ")})` : ""}`);
  L.push("");
  L.push(`## More or fewer confirmed faces`, "");
  L.push(`| Confirmed faces | Matched against | Student faces | Named by itself | Wrong | Named or "Likely" (right) | Not named | Strangers named |`, `|---|---|---|---|---|---|---|---|`);
  for (const r of runs) L.push(`| ${r.k} | ${r.scope === "class" ? "own class + staff" : "whole school"} | ${r.tests} | ${pct(r.right, r.tests)} | ${r.wrong} | ${pct(r.right + r.sugRight, r.tests)} | ${r.missed} | ${r.strangerNamed}/${r.strangers} |`);
  L.push("", `"Whole school" is how an event photo with no class folder is matched; it is harder than a class photo.`, "");
  L.push(`## Each class (${MAIN_K} confirmed faces, own class)`, "");
  L.push(`| Class | Student faces | Named by itself | Wrong | "Likely" (right) | Not named |`, `|---|---|---|---|---|---|`);
  for (const [c, v] of Object.entries(main.perClass).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) L.push(`| ${c} | ${v.tests} | ${pct(v.right, v.tests)} | ${v.wrong} | ${v.sugRight} | ${v.missed} |`);
  L.push("");
  L.push(`## Why faces were not named (${main.missed} faces)`, "");
  const whys = Object.entries(main.why).sort((a, b) => b[1] - a[1]);
  if (!whys.length) L.push("Every student face was named.");
  else {
    L.push(`| Reason | Faces | Share of misses |`, `|---|---|---|`);
    for (const [w, n] of whys) L.push(`| ${w} | ${n} | ${pct(n, main.missed)} |`);
    L.push("", `How to read it: "first guess is someone else" and "not sure enough" are limits of the recogniser; "no face found" / "not usable" / "small or blurred" are photo problems (the app never guesses on those, on purpose).`);
  }
  L.push("");
  if (main.wrongList.length || main.strangerList.length) {
    L.push(`## Wrong names (must be 0)`, "");
    for (const w of main.wrongList) L.push(`- ${where(w.p)}: ${who(w.truth)} named as ${who(w.named)}`);
    for (const w of main.strangerList) L.push(`- ${where(w.p)}: someone not on the list named as ${who(w.named)}`);
    L.push("");
  }
  const worst = Object.entries(main.perStudent).filter(([, v]) => v.tests >= 3).sort((a, b) => a[1].right / a[1].tests - b[1].right / b[1].tests).slice(0, 10).filter(([, v]) => v.right < v.tests);
  if (worst.length) {
    L.push(`## Students named least often`, "");
    for (const [id, v] of worst) L.push(`- ${who(id)}: ${v.right} of ${v.tests} named${v.wrong ? `, ${v.wrong} wrong` : ""}`);
    L.push("");
  }
  if (lookAlikes.length) {
    L.push(`## Look-alikes (twins, siblings or just similar — mark them in the app so it always asks)`, "");
    for (const x of lookAlikes.slice(0, 15)) L.push(`- ${who(x.a)} and ${who(x.b)} (closeness ${x.s.toFixed(2)})`);
    L.push("");
  }
  if (withNames && main.missList.length) {
    L.push(`## Every face not named (${MAIN_K} confirmed faces)`, "");
    for (const m of main.missList) L.push(`- ${where(m.p)}: ${nameOf(m.truth)} — ${m.why}${m.guess && m.guess !== m.truth ? ` (first guess ${nameOf(m.guess)})` : ""}`);
    L.push("");
  }
  return L.join("\n");
}

const strip = (r) => ({ k: r.k, scope: r.scope, tests: r.tests, right: r.right, wrong: r.wrong, sugRight: r.sugRight, sugWrong: r.sugWrong, missed: r.missed, why: r.why, strangers: r.strangers, strangerNamed: r.strangerNamed, classFaces: r.classFaces, classNamed: r.classNamed, perClass: r.perClass, hand: r.hand, learned: r.learned });
await mkdir(OUT, { recursive: true });
const summary = report(false);
await writeFile(path.join(OUT, "summary.md"), summary);
await writeFile(path.join(OUT, "summary.json"), JSON.stringify({ at: new Date().toISOString(), recogniser, mainK: MAIN_K, runs: runs.map(strip), unclear: unclear.length, unmatchedFolders: unmatched.length, lookAlikes: lookAlikes.length }, null, 2));
await writeFile(path.join(PRIV, "report-with-names.md"), report(true));

// ---- 5. A page to look at the names by eye (private) -------------------------
// Face pictures of every wrong name, every name given on class photos and
// people not on the list, and the misses, so a person can check them.
const crops = path.join(PRIV, "faces");
await mkdir(crops, { recursive: true });
async function crop(p, fi, tag) {
  const f = p.faces[fi];
  if (!f || !p.width) return null;
  const name = `${p.id}-${fi}.jpg`;
  const out = path.join(crops, name);
  if (!existsSync(out)) {
    try {
      const W = p.width, H = p.height;
      const pad = 0.35;
      const x = Math.max(0, Math.round((f.box[0] - f.box[2] * pad) * W)), y = Math.max(0, Math.round((f.box[1] - f.box[3] * pad) * H));
      const w = Math.min(W - x, Math.round(f.box[2] * (1 + 2 * pad) * W)), h = Math.min(H - y, Math.round(f.box[3] * (1 + 2 * pad) * H));
      await sharp(await source(p.file), { failOn: "none" }).rotate().extract({ left: x, top: y, width: Math.max(1, w), height: Math.max(1, h) }).resize(160, 160, { fit: "cover" }).jpeg({ quality: 80 }).toFile(out);
    } catch {
      return null;
    }
  }
  return `faces/${name}`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const refs = new Map(); // student -> first confirmed face crop
{
  const { hand } = confirmed(MAIN_K);
  for (const h of hand) if (!refs.has(h.studentId)) {
    const p = photos[h.photoId];
    refs.set(h.studentId, await crop(p, p.truthFace));
  }
}
const cards = [];
async function card(group, p, fi, named, note) {
  const img = await crop(p, fi);
  const ref = named ? refs.get(named) : null;
  cards.push(`<div class="card" data-group="${group}"><div class="pics">${img ? `<img src="${img}">` : ""}${ref ? `<img src="${ref}" class="ref" title="confirmed face">` : ""}</div><b>${esc(named ? nameOf(named) : "—")}</b><small>${esc(note)}</small><small class="f">${esc(path.relative(ROOT, p.file))}</small><label><input type="checkbox"> wrong</label></div>`);
}
for (const w of main.wrongList) await card("wrong", w.p, w.fi, w.named, `really ${nameOf(w.truth)}`);
for (const w of main.strangerList) await card("wrong", w.p, w.fi, w.named, "not on the list");
for (const w of main.classList.slice(0, 600)) await card("class", w.p, w.fi, w.named, "class/event photo");
for (const m of main.missList.slice(0, 300)) await card("miss", m.p, m.fi >= 0 ? m.fi : 0, m.truth, m.why);
await writeFile(
  path.join(PRIV, "check.html"),
  `<!doctype html><meta charset="utf-8"><title>Face test check</title><style>
body{font:14px system-ui;margin:16px;background:#fafafa;color:#222}h2{margin-top:28px}.grid{display:flex;flex-wrap:wrap;gap:10px}
.card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px;width:180px;display:flex;flex-direction:column;gap:3px}
.card.bad{border-color:#c00;background:#fee}.pics{display:flex;gap:4px}.pics img{width:84px;height:84px;object-fit:cover;border-radius:4px}.ref{opacity:.85;outline:2px solid #8a8}
small{color:#666}.f{font-size:10px;word-break:break-all}#count{position:sticky;top:0;background:#ffd;padding:8px;border:1px solid #cc9}
</style><div id="count"></div>
<p>Each card: the face from the photo, and next to it (green edge) one of the faces confirmed for that name. Tick "wrong" on any card where the name is not that person. The count at the top is what to tell Claude (no names needed).</p>
<h2>Named wrong (should be none)</h2><div class="grid">${cards.filter((c) => c.includes('data-group="wrong"')).join("") || "<p>None.</p>"}</div>
<h2>Named by itself on class/event photos (no answer key: please look)</h2><div class="grid">${cards.filter((c) => c.includes('data-group="class"')).join("") || "<p>No class photos given.</p>"}</div>
<h2>Not named (the name shown is who it really is)</h2><div class="grid">${cards.filter((c) => c.includes('data-group="miss"')).join("") || "<p>None.</p>"}</div>
<script>
const upd=()=>{const n=[...document.querySelectorAll('[data-group="class"] input:checked')].length;const all=document.querySelectorAll('[data-group="class"]').length;document.getElementById('count').textContent='Class/event photos: '+n+' of '+all+' names ticked wrong.';document.querySelectorAll('.card').forEach(c=>c.classList.toggle('bad',c.querySelector('input').checked))};
document.addEventListener('change',upd);upd();
</script>`,
);

console.log(summary);
console.log(`\nShareable (no names): ${path.join(OUT, "summary.md")}\nPrivate (names, faces — keep on this computer, delete when done): ${PRIV}`);
