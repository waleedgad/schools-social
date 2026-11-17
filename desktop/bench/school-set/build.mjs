// Lays out a realistic school drive from the photos fetch.mjs downloaded.
//   node bench/school-set/build.mjs <photos-dir> <out-dir>
// The drive looks like what a school hands over on day one:
//   Class lists/   September list (our template) and a November list from
//                  Classera (a student moved, one left, one new)
//   Portraits/     one portrait per student, named by student ID (one
//                  missing, one in lower case)
//   Photos/        the photo library: Year / Term / Event / Class, an
//                  Arabic event name, an Edited folder, an Unsorted folder
//   Cards/         memory cards to import by hand: Canon (bursts, blurred,
//                  dark, bright, rotated, far-away faces, lens cap, broken
//                  files, macOS ._ files), Nikon (real RAW + JPG pairs, the
//                  camera clock a year behind), iPhone (HEIC when heif-enc
//                  is installed, a video when ffmpeg is)
//   Phone uploads/ WhatsApp-style re-saved copies of library photos
//   Photographer upload/ big files with long, spaced and Arabic names
//   manifest.json  the truth about every file: who is in it (from the
//                  Commons categories it came from), what was done to it
//   CREDITS.md     author, licence and source of every photo
// Same input, same output: everything is picked with a fixed seed.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(process.argv[2] ?? "school-set-photos");
const out = path.resolve(process.argv[3] ?? "school-set");
const school = JSON.parse(readFileSync(path.join(here, "school.json"), "utf8"));
const credits = existsSync(path.join(src, "credits.json")) ? JSON.parse(readFileSync(path.join(src, "credits.json"), "utf8")) : [];
const creditOf = new Map(credits.map((c) => [c.file, c]));

let seed = 20261117;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const has = (cmd) => {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const manifest = { built: new Date().toISOString(), note: "people = who is known to be in the photo (the Commons categories it came from); others may be in it too.", students: [], teachers: [], files: [] };
const note = (file, entry) => manifest.files.push({ path: path.relative(out, file).split(path.sep).join("/"), ...entry });
const dir = (...parts) => {
  const d = path.join(out, ...parts);
  mkdirSync(d, { recursive: true });
  return d;
};

// ---------- who is who ----------
const students = school.classes.flatMap((c) => c.students.map((s) => ({ ...s, className: c.name, grade: c.grade, section: c.section, kind: "student", canPost: s.canPost !== false })));
const teachers = school.teachers.map((t) => ({ ...t, className: t.classes[0], kind: "teacher", canPost: true }));
const everyone = [...students, ...teachers];
const photosOf = (id) => {
  const d = path.join(src, "people", id);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".jpg")).sort().map((f) => path.join(d, f)) : [];
};
// The same Commons file can be in two people's categories (a crew photo):
// it is used once, and both people are "in" it.
const byTitle = new Map();
for (const p of everyone)
  for (const f of photosOf(p.id)) {
    const c = creditOf.get(path.relative(src, f).split(path.sep).join("/"));
    const key = c?.title ?? f;
    const e = byTitle.get(key) ?? { file: f, people: new Set(), credit: c };
    e.people.add(p.id);
    byTitle.set(key, e);
  }
const peopleIn = (f) => {
  const c = creditOf.get(path.relative(src, f).split(path.sep).join("/"));
  return [...(byTitle.get(c?.title ?? f)?.people ?? [])];
};
const firstOwner = (f, id) => {
  const c = creditOf.get(path.relative(src, f).split(path.sep).join("/"));
  return byTitle.get(c?.title ?? f)?.file === f || !byTitle.get(c?.title ?? f)?.people.has(id);
};
const used = new Set();

// ---------- writing photos ----------
// Cameras write local time (the school is in Cairo); file times are the real moment.
const exifDate = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}:${p.month}:${p.day} ${p.hour}:${p.minute}:${p.second}`;
};
async function save(from, to, { when, camera = ["Canon", "Canon EOS R6"], long = null, quality = 90, op = null, exif = true, orientation = null } = {}) {
  // Turned upright and sized first, so an edit (crop, blur, turn) works on
  // the picture as seen; sharp allows only one turn per step.
  let first = sharp(from, { failOn: "none" }).rotate();
  if (long) first = first.resize(long, long, { fit: "inside", withoutEnlargement: long < 2500, kernel: "lanczos3" });
  const buf = await first.toBuffer();
  const meta = await sharp(buf).metadata();
  let img = sharp(buf);
  if (op) img = await op(img, meta);
  img = img.jpeg({ quality, mozjpeg: false });
  if (exif && when) img = img.withExif({ IFD0: { Make: camera[0], Model: camera[1], DateTime: exifDate(when), Software: "Test set" }, IFD2: { DateTimeOriginal: exifDate(when), CreateDate: exifDate(when) } });
  if (orientation) img = img.withMetadata({ orientation });
  mkdirSync(path.dirname(to), { recursive: true });
  await img.toFile(to);
  if (when) utimesSync(to, when, when);
  used.add(from);
  return to;
}
const sourceOf = (f) => creditOf.get(path.relative(src, f).split(path.sep).join("/"))?.page ?? null;

// ---------- class lists ----------
async function writeList(file, sheetName, header, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => (c.width = 22));
  await wb.xlsx.writeFile(file);
}
const lists = dir("Class lists");
// September: our template, every student, the portrait file name.
await writeList(
  path.join(lists, "Class list September 2026.xlsx"),
  "Students",
  ["Student ID", "Name English", "Name Arabic", "Gender", "Grade", "Section", "Portrait file", "Can appear in posts"],
  students.map((s) => [s.id, s.en, s.ar, s.gender, s.grade, s.section, `${s.id}.jpg`, s.canPost ? "Yes" : "No"]),
);
note(path.join(lists, "Class list September 2026.xlsx"), { kind: "class-list", format: "hub", students: students.length });
// November, from Classera: S1008 moved to 11A, S1205 left, S9011 is new
// (and has no photos at all), names in Arabic first.
const nov = students.filter((s) => s.id !== "S1205").map((s) => (s.id === "S1008" ? { ...s, grade: "Grade 11", section: "A", className: "11A" } : s));
nov.push({ id: "S9011", en: "Mazen Hatem", ar: "مازن حاتم", gender: "M", grade: "Grade 9", section: "A", className: "9A", canPost: true, kind: "student", noPhotos: true });
await writeList(
  path.join(lists, "Class list November 2026 (Classera).xlsx"),
  "الطلاب",
  ["رقم الطالب", "اسم الطالب", "الاسم بالإنجليزية", "الجنس", "الصف", "الشعبة", "موافقة النشر"],
  nov.map((s) => [s.id, s.ar, s.en, s.gender === "M" ? "ذكر" : "أنثى", s.grade.replace("Grade ", "الصف "), s.section, s.canPost ? "نعم" : "لا"]),
);
note(path.join(lists, "Class list November 2026 (Classera).xlsx"), { kind: "class-list", format: "classera", students: nov.length, changes: { moved: ["S1008 10A -> 11A"], left: ["S1205"], added: ["S9011 (no photos)"] } });
// Teachers as a staff list.
await writeList(
  path.join(lists, "Staff.xlsx"),
  "Staff",
  ["Staff ID", "Name English", "Name Arabic", "Gender", "Class"],
  teachers.map((t) => [t.id, t.en, t.ar, t.gender, t.classes.join(", ")]),
);
note(path.join(lists, "Staff.xlsx"), { kind: "staff-list", staff: teachers.length });

// ---------- portraits ----------
const portraits = dir("Portraits");
for (const p of everyone) {
  const [first] = photosOf(p.id);
  const entry = { id: p.id, en: p.en, ar: p.ar, kind: p.kind, className: p.className, canPost: p.canPost, photos: photosOf(p.id).length, portrait: null };
  (p.kind === "student" ? manifest.students : manifest.teachers).push(entry);
  if (!first) continue;
  // S1203's portrait is missing (the school forgot it); S1001's file is in lower case.
  if (p.id === "S1203") continue;
  const name = p.id === "S1001" ? `${p.id.toLowerCase()}.JPG` : `${p.id}.jpg`;
  const to = await save(first, path.join(portraits, name), { long: 1200, exif: false });
  entry.portrait = path.basename(to);
  note(to, { kind: "portrait", people: [p.id], source: sourceOf(first) });
}
manifest.students.push({ id: "S9011", en: "Mazen Hatem", ar: "مازن حاتم", kind: "student", className: "9A", canPost: true, photos: 0, portrait: null, note: "only on the November list" });

// ---------- the library ----------
const lib = dir("Photos");
const EVENTS = [
  { folder: "2026-09-20 First day", date: "2026-09-20", classes: true },
  { folder: "2026-10-06 احتفال أكتوبر", date: "2026-10-06", classes: false },
  { folder: "2026-10-22 Science fair", date: "2026-10-22", classes: true, edited: true },
  { folder: "2026-11-05 Sports day", date: "2026-11-05", classes: true },
];
const at = (date, minutes) => new Date(`${date}T08:00:00Z`).getTime() + minutes * 60_000;
const libraryFiles = [];
const cardQueue = [];
const photographerQueue = [];
for (const p of everyone) {
  const list = photosOf(p.id).slice(1);
  for (const [i, f] of list.entries()) {
    if (!firstOwner(f, p.id)) continue;
    if (i % 4 === 3) cardQueue.push({ f, p });
    else if (i % 9 === 5) photographerQueue.push({ f, p });
    else {
      const ev = EVENTS[i % EVENTS.length];
      const sub = ev.classes ? [p.className] : [];
      const n = libraryFiles.length + 1;
      const when = new Date(at(ev.date, Math.floor(rand() * 300)));
      const to = await save(f, path.join(lib, "2026-2027", "Term 1", ev.folder, ...sub, `IMG_${String(1000 + n).padStart(4, "0")}.JPG`), { when });
      libraryFiles.push({ to, f, p, ev });
      note(to, { kind: "photo", people: peopleIn(f), event: ev.folder, className: ev.classes ? p.className : null, source: sourceOf(f) });
    }
  }
}
// Whole-class pictures in each class's Sports day folder.
for (const c of school.classes) {
  const d = path.join(src, "groups", c.name);
  if (!existsSync(d)) continue;
  for (const [i, g] of readdirSync(d).filter((f) => f.endsWith(".jpg")).sort().entries()) {
    const to = await save(path.join(d, g), path.join(lib, "2026-2027", "Term 1", "2026-11-05 Sports day", c.name, `Class photo ${c.name} ${i + 1}.jpg`), { when: new Date(at("2026-11-05", 200 + i)) });
    note(to, { kind: "class-photo", className: c.name, people: c.students.map((s) => s.id), peopleNote: "the astronaut class this stands in for; who exactly is in it is not known", source: sourceOf(path.join(d, g)) });
  }
}
// Edited copies (cropped, brighter) next to the originals; and an exact
// copy of a photo filed in a second event by mistake.
{
  const sci = libraryFiles.filter((l) => l.ev.edited).slice(0, 6);
  for (const l of sci) {
    const to = path.join(path.dirname(l.to), "Edited", path.basename(l.to).replace(".JPG", "-edit.jpg"));
    await save(l.to, to, { when: new Date(statSync(l.to).mtimeMs), op: async (img, m) => { return img.extract({ left: Math.round(m.width * 0.08), top: Math.round(m.height * 0.08), width: Math.round(m.width * 0.84), height: Math.round(m.height * 0.84) }).modulate({ brightness: 1.12, saturation: 1.1 }); } });
    note(to, { kind: "edited", of: path.relative(out, l.to), people: peopleIn(l.f) });
  }
  const twice = libraryFiles.slice(0, 3);
  for (const l of twice) {
    const to = path.join(lib, "2026-2027", "Term 1", "2026-11-05 Sports day", `copy of ${path.basename(l.to)}`);
    copyFileSync(l.to, to);
    note(to, { kind: "duplicate", of: path.relative(out, l.to), people: peopleIn(l.f) });
  }
  // Photos nobody filed: straight in the library, no dates in the folder.
  for (const l of libraryFiles.slice(10, 14)) {
    const to = path.join(lib, "Unsorted", `scan ${path.basename(l.to)}`);
    await save(l.f, to, { exif: false });
    note(to, { kind: "unfiled", people: peopleIn(l.f), source: sourceOf(l.f) });
  }
}

// ---------- memory cards ----------
const canon = dir("Cards", "CANON_R6", "DCIM", "100CANON");
let n = 1;
const imgName = () => `IMG_${String(n++).padStart(4, "0")}.JPG`;
// Two events on one day (morning sports, afternoon assembly, with a lunch
// gap) and one two days later. Shots in an event are 20-60 s apart.
const EVENTS_ON_CARD = [
  { name: "2026-11-10 morning (Sports)", start: at("2026-11-10", 60) },
  { name: "2026-11-10 afternoon (Assembly)", start: at("2026-11-10", 330) },
  { name: "2026-11-12 (Art exhibition)", start: at("2026-11-12", 90) },
];
const clock = EVENTS_ON_CARD.map((e) => e.start);
const canonMade = [];
for (const [i, { f, p }] of cardQueue.entries()) {
  const e = i % 3;
  clock[e] += 20_000 + Math.floor(rand() * 40_000);
  const when = new Date(clock[e]);
  const which = EVENTS_ON_CARD[e].name;
  const people = peopleIn(f);
  const mode = i % 11;
  const base = { when, long: 3000, quality: 92 };
  if (mode === 1) {
    // A burst: five shots in two seconds, slightly different framing.
    const burst = [];
    for (let k = 0; k < 5; k++) {
      const shift = k * 0.012;
      const t = new Date(when.getTime() + k * 400);
      clock[e] = t.getTime();
      const to = await save(f, path.join(canon, imgName()), { ...base, when: t, op: async (img, m) => { return img.extract({ left: Math.round(m.width * shift), top: Math.round(m.height * (0.03 - shift / 2)), width: Math.round(m.width * 0.94), height: Math.round(m.height * 0.94) }); } });
      burst.push(path.basename(to));
      note(to, { kind: "burst", burst: path.basename(burst[0]), people, event: which });
    }
    continue;
  }
  const ops = {
    2: ["blurry", (img) => img.blur(9)],
    4: ["dark", (img) => img.linear(0.14, 0)],
    6: ["too-bright", (img) => img.linear(2.4, 40)],
    8: ["rotated", (img) => img.rotate(-90)],
  };
  const [kind, op] = ops[mode] ?? ["photo", null];
  const to = await save(f, path.join(canon, imgName()), { ...base, op, orientation: kind === "rotated" ? 6 : null });
  canonMade.push(to);
  note(to, { kind, people, event: which, ...(kind === "rotated" ? { note: "pixels turned, EXIF Orientation 6: must show upright" } : {}) });
  if (mode === 9) {
    // The same people seen from far away: the face is a few pixels across.
    const small = await sharp(f).rotate().resize(110, 110, { fit: "inside" }).toBuffer();
    const t = new Date(when.getTime() + 1500);
    const far = path.join(canon, imgName());
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 96, g: 128, b: 70 } } })
      .composite([{ input: small, left: 1400, top: 700 }])
      .jpeg({ quality: 90 })
      .withExif({ IFD0: { Make: "Canon", Model: "Canon EOS R6", DateTime: exifDate(t) }, IFD2: { DateTimeOriginal: exifDate(t) } })
      .toFile(far);
    utimesSync(far, t, t);
    note(far, { kind: "far-faces", people, note: "faces about 30 px across: must never be named" });
  }
}
// Lens cap, a broken half-copied file, an empty file, text with a .JPG name,
// a PNG with a .JPG name, CMYK, grey, a 64 px thumbnail, a huge panorama,
// macOS ._ files and the camera's own folders.
{
  const t = new Date(clock[2] + 60_000);
  const cap = path.join(canon, imgName());
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 6, g: 6, b: 8 } } }).jpeg().withExif({ IFD0: { Make: "Canon", Model: "Canon EOS R6", DateTime: exifDate(t) }, IFD2: { DateTimeOriginal: exifDate(t) } }).toFile(cap);
  note(cap, { kind: "lens-cap", people: [] });
  if (canonMade.length) {
    const whole = readFileSync(canonMade[0]);
    const half = path.join(canon, imgName());
    writeFileSync(half, whole.subarray(0, Math.floor(whole.length / 2)));
    note(half, { kind: "broken", note: "cut in half (card pulled out while copying)", of: path.relative(out, canonMade[0]) });
  }
  const empty = path.join(canon, imgName());
  writeFileSync(empty, "");
  note(empty, { kind: "broken", note: "0 bytes" });
  const text = path.join(canon, imgName());
  writeFileSync(text, "this is not a photo\n");
  note(text, { kind: "broken", note: "text with a .JPG name" });
  if (libraryFiles.length > 20) {
    const png = path.join(canon, imgName());
    await sharp(libraryFiles[20].f).rotate().resize(1600).png().toFile(png);
    note(png, { kind: "wrong-extension", note: "a PNG named .JPG", people: peopleIn(libraryFiles[20].f) });
    const cmyk = path.join(canon, imgName());
    await sharp(libraryFiles[21].f).rotate().resize(2000).toColourspace("cmyk").jpeg().toFile(cmyk);
    note(cmyk, { kind: "cmyk", people: peopleIn(libraryFiles[21].f) });
    const grey = path.join(canon, imgName());
    await sharp(libraryFiles[22].f).rotate().resize(2000).greyscale().jpeg().toFile(grey);
    note(grey, { kind: "greyscale", people: peopleIn(libraryFiles[22].f) });
    const thumb = path.join(canon, imgName());
    await sharp(libraryFiles[23].f).rotate().resize(64).jpeg().toFile(thumb);
    note(thumb, { kind: "tiny-file", note: "64 px wide", people: peopleIn(libraryFiles[23].f) });
    const pano = path.join(canon, imgName());
    await sharp(libraryFiles[24].f).rotate().resize(12000, 2000, { fit: "fill" }).jpeg({ quality: 80 }).toFile(pano);
    note(pano, { kind: "panorama", note: "12000 x 2000", people: peopleIn(libraryFiles[24].f) });
  }
  for (const f of readdirSync(canon).slice(0, 5)) {
    writeFileSync(path.join(canon, `._${f}`), Buffer.alloc(4096, 0));
    note(path.join(canon, `._${f}`), { kind: "junk", note: "macOS resource file" });
  }
  // On a card every file's time is when the camera wrote it.
  for (const f of readdirSync(canon)) if (statSync(path.join(canon, f)).mtimeMs > Date.now() - 86_400_000) utimesSync(path.join(canon, f), t, t);
  writeFileSync(path.join(out, "Cards", "CANON_R6", ".DS_Store"), Buffer.alloc(6148, 0));
  dir("Cards", "CANON_R6", "MISC");
  writeFileSync(path.join(out, "Cards", "CANON_R6", "MISC", "AUTPRINT.MRK"), "[HDR]\n");
  note(path.join(out, "Cards", "CANON_R6", "MISC", "AUTPRINT.MRK"), { kind: "junk", note: "camera print order file" });
}
// Nikon: real RAW files with the camera's JPG beside them (RAW + JPG), and
// photos with the camera clock a year behind (2025 instead of 2026).
{
  const nikon = dir("Cards", "NIKON_D850", "DCIM", "100NIKON");
  const raws = existsSync(path.join(src, "raw")) ? readdirSync(path.join(src, "raw")).filter((f) => /\.nef$/i.test(f)).sort() : [];
  let k = 1;
  const { rawPreview } = await import(path.join(here, "..", "..", "dist", "core", "media.js")).catch(() => ({}));
  for (const r of raws) {
    const name = `DSC_${String(k++).padStart(4, "0")}`;
    const to = path.join(nikon, `${name}.NEF`);
    copyFileSync(path.join(src, "raw", r), to);
    note(to, { kind: "raw", people: [], note: "NASA ISS photo (no faces)", source: "https://github.com/letmaik/rawpy/tree/main/test" });
    if (rawPreview) {
      const jpg = path.join(nikon, `${name}.JPG`);
      writeFileSync(jpg, await rawPreview(to));
      note(jpg, { kind: "raw-pair-jpg", of: path.relative(out, to), people: [] });
    }
  }
  for (const { f } of photographerQueue.slice(0, 8)) {
    const when = new Date(at("2025-11-14", 120 + k * 3));
    const to = await save(f, path.join(nikon, `DSC_${String(k++).padStart(4, "0")}.JPG`), { when, camera: ["NIKON CORPORATION", "NIKON D850"], long: 3000 });
    note(to, { kind: "wrong-clock", people: peopleIn(f), note: "taken 2026-11-14, camera clock set to 2025" });
  }
}
// iPhone: HEIC photos (when heif-enc is installed) and a short video (when ffmpeg is).
{
  const phone = dir("Cards", "IPHONE", "DCIM", "100APPLE");
  const some = libraryFiles.slice(30, 36);
  for (const [i, l] of some.entries()) {
    const when = new Date(at("2026-11-13", 30 + i * 2));
    const jpg = path.join(phone, `IMG_${4001 + i}.JPG`);
    await save(l.f, jpg, { when, camera: ["Apple", "iPhone 15 Pro"], long: 3024 });
    if (i % 2 === 0 && has("heif-enc")) {
      const heic = jpg.replace(/\.JPG$/, ".HEIC");
      try {
        execFileSync("heif-enc", ["-q", "80", "-o", heic, jpg], { stdio: "ignore" });
        // heif-enc doesn't keep the date: the file time is all there is.
        utimesSync(heic, when, when);
        (await import("node:fs")).rmSync(jpg);
        note(heic, { kind: "heic", people: peopleIn(l.f) });
        continue;
      } catch {
        // keep the JPG
      }
    }
    note(jpg, { kind: "photo", people: peopleIn(l.f) });
  }
  if (has("ffmpeg") && some.length) {
    const mov = path.join(phone, "IMG_4100.MOV");
    try {
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-loop", "1", "-i", some[0].to, "-t", "3", "-vf", "scale=1280:-2,format=yuv420p", "-c:v", "libx264", mov], { stdio: "ignore" });
      note(mov, { kind: "video", people: peopleIn(some[0].f) });
    } catch {
      // no video
    }
  }
}

// ---------- staff phone uploads (WhatsApp re-saves) ----------
{
  const up = dir("Phone uploads");
  for (const [i, l] of libraryFiles.slice(40, 52).entries()) {
    const to = path.join(up, `WhatsApp Image 2026-11-0${1 + (i % 8)} at ${10 + (i % 9)}.${String(10 + i).padStart(2, "0")}.${String(i * 7 % 60).padStart(2, "0")}.jpeg`);
    await save(l.to, to, { long: 1600, quality: 70, exif: false });
    note(to, { kind: "resaved", of: path.relative(out, l.to), people: peopleIn(l.f), note: "smaller, re-compressed, no camera data" });
  }
}

// ---------- photographer upload ----------
{
  const up = dir("Photographer upload");
  const names = (i) => [`Al Nour School Sports Day 2026 - Final selection - ${String(i + 1).padStart(3, "0")}.jpg`, `مدرسة النور يوم رياضي ${i + 1}.jpg`, `DSC0${8800 + i} (1).jpg`][i % 3];
  for (const [i, { f }] of photographerQueue.slice(8).entries()) {
    const when = new Date(at("2026-11-05", 30 + i * 4));
    const to = await save(f, path.join(up, names(i)), { when, camera: ["SONY", "ILCE-7M4"], long: 4000, quality: 95 });
    note(to, { kind: "photo", people: peopleIn(f), source: sourceOf(f) });
  }
}

// ---------- truth and credits ----------
const counts = {};
for (const f of manifest.files) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
manifest.counts = counts;
const named = new Map();
for (const f of manifest.files) for (const id of f.people ?? []) if (f.kind !== "class-photo") named.set(id, (named.get(id) ?? 0) + 1);
for (const s of [...manifest.students, ...manifest.teachers]) s.inFiles = named.get(s.id) ?? 0;
writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
const usedCredits = credits.filter((c) => used.has(path.join(src, c.file)) || c.raw);
writeFileSync(
  path.join(out, "CREDITS.md"),
  `# Photo credits\n\nEvery photo is from Wikimedia Commons under a licence that allows commercial use (mostly public domain NASA photos), or NASA RAW files from the rawpy project. The people in them are NASA astronauts standing in for students and teachers; the student and teacher names are made up.\n\n| File | Title | Author | Licence | Source |\n|---|---|---|---|---|\n${usedCredits.map((c) => `| ${c.file} | ${String(c.title).replace(/\|/g, "/")} | ${String(c.author).replace(/\|/g, "/")} | ${c.licence} | ${c.page} |`).join("\n")}\n`,
);
writeFileSync(
  path.join(out, "README.md"),
  `# Test school drive (${school.school.en})\n\nA made-up school for testing School Social Hub before a real school does. ${manifest.students.length} students in ${school.classes.length} classes, ${manifest.teachers.length} teachers.\n\n- Class lists/: September list (our template, with portrait file names) and a November list from Classera (S1008 moved to 11A, S1205 left, S9011 new with no photos). Staff.xlsx for teachers.\n- Portraits/: one per student by ID. S1203 has none; S1001's file is lower case.\n- Photos/: the library (point the app at this folder).\n- Cards/: copy one into a USB stick or SD card (or a folder) and import it.\n- Phone uploads/, Photographer upload/: for the website upload and Import.\n- manifest.json: what is in every file, and what was done to it.\n\nFiles by kind: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.\n`,
);
console.log(`Built ${manifest.files.length} files in ${out}`);
console.log(counts);
const few = [...manifest.students, ...manifest.teachers].filter((s) => s.inFiles < 4 && s.id !== "S9011");
if (few.length) console.log(`People in fewer than 4 files: ${few.map((s) => `${s.id} (${s.inFiles})`).join(", ")}`);
