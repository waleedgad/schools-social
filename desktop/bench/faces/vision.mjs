// Mac only: how often Apple Vision's "second look" throws away a real face.
//   npm run build && node bench/faces/vision.mjs <photos-dir> [max-per-person]
// The app's face finder runs on every stand-in photo twice, without and
// with Apple Vision (as the Mac app does with "Second look with Apple
// Vision" on, the default). Every person folder holds photos of one person,
// so the biggest face in each photo is a real face: when Vision rules it
// out ("not-a-face" or "blurred"), a real student would be lost on the Mac
// (B-86). Made-up class photos (many small faces) are checked the same way.
// Writes vision-report.md into the photos folder and prints it.
import { createRequire } from "node:module";
import { readdir, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "../..");
const F = require(path.join(desktop, "dist/core/faces.js"));
const V = require(path.join(desktop, "dist/core/vision.js"));
const sharp = require("sharp");
const MODELS = path.join(desktop, "models");
const photos = path.resolve(process.argv[2] ?? "face-bench-photos");
const PER = Number(process.argv[3] ?? 12);

if (process.platform !== "darwin") {
  console.log("Apple Vision is only on the Mac: nothing to check here.");
  process.exit(0);
}

const buckets = [
  [0, 60, "under 60 px"],
  [60, 90, "60-90 px"],
  [90, 150, "90-150 px"],
  [150, 1e9, "150 px and more"],
];
const tally = () => buckets.map(() => ({ faces: 0, unseen: 0, unseenNew: 0, poor: 0, visionFailed: 0 }));
const single = tally();
const group = tally();
const bucket = (p) => buckets.findIndex(([a, b]) => p >= a && p < b);
const iou = (a, b) => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a[2] * a[3] + b[2] * b[3] - i);
};
const inside = (a, b) => {
  const cx = a[0] + a[2] / 2, cy = a[1] + a[3] / 2;
  return cx > b[0] && cx < b[0] + b[2] && cy > b[1] && cy < b[1] + b[3];
};

// Old rule (0.10): a face Vision didn't see was "not a face". New rule
// (0.11): only when the face is big enough for Vision to see (visionCanSee).
async function check(file, all, t) {
  const { data, info } = await sharp(file, { failOn: "none" }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const jpeg = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).resize({ width: 1600, height: 1600, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  const plain = (await F.findFaces(MODELS, file)).filter((f) => f.usable);
  const faces = all ? plain : plain.sort((a, b) => b.box[2] - a.box[2]).slice(0, 1);
  if (!faces.length) return;
  const vision = await V.visionFaces(jpeg);
  for (const f of faces) {
    const b = bucket(F.facePx(f.box[2], info.width, info.height));
    t[b].faces++;
    if (!vision) {
      t[b].visionFailed++;
      continue;
    }
    const v = vision.find((vf) => iou(vf.box, f.box) > 0.25 || inside(f.box, vf.box));
    if (!v) {
      t[b].unseen++;
      if (F.visionCanSee(f.box, info.width, info.height)) t[b].unseenNew++;
    } else if (v.quality < 0.12) t[b].poor++;
  }
}

const people = (await readdir(photos, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== "groups").map((d) => d.name).sort();
for (const p of people) {
  const files = (await readdir(path.join(photos, p))).filter((f) => f.endsWith(".jpg")).sort().slice(0, PER);
  for (const f of files) await check(path.join(photos, p, f), false, single).catch((e) => console.log(`${p}/${f}: ${e.message}`));
}

// Made-up class photos: 4 rows of 6 faces cut from the single photos, at
// three sizes (a class photo taken from close up, middle, far back).
const tmp = await mkdtemp(path.join(tmpdir(), "vision-groups-"));
let n = 0;
for (const size of [70, 110, 170]) {
  for (let g = 0; g < 6; g++) {
    const tiles = [];
    for (let i = 0; i < 24; i++) {
      const p = people[(g * 24 + i) % people.length];
      const files = (await readdir(path.join(photos, p))).filter((f) => f.endsWith(".jpg")).sort();
      if (!files.length) continue;
      const src = path.join(photos, p, files[(g + i) % files.length]);
      const found = (await F.findFaces(MODELS, src).catch(() => [])).filter((f) => f.usable).sort((a, b) => b.box[2] - a.box[2])[0];
      if (!found) continue;
      const m = await sharp(src).rotate().metadata();
      const side = Math.round(found.box[2] * m.width * 2.2);
      const left = Math.max(0, Math.round((found.box[0] + found.box[2] / 2) * m.width - side / 2));
      const top = Math.max(0, Math.round((found.box[1] + found.box[3] / 2) * m.height - side / 2));
      if (side < 8) continue;
      const cut = await sharp(src).rotate().extract({ left, top, width: Math.min(side, m.width - left), height: Math.min(side, m.height - top) }).resize(Math.round(size * 2.2), Math.round(size * 2.2), { fit: "cover" }).toBuffer();
      tiles.push({ input: cut, left: 60 + (i % 6) * Math.round(size * 2.4), top: 60 + Math.floor(i / 6) * Math.round(size * 2.4) });
    }
    const W = 120 + 6 * Math.round(size * 2.4), H = 120 + 4 * Math.round(size * 2.4);
    const file = path.join(tmp, `group-${size}-${g}.jpg`);
    await sharp({ create: { width: W, height: H, channels: 3, background: { r: 110, g: 120, b: 130 } } }).composite(tiles).jpeg({ quality: 90 }).toFile(file);
    await check(file, true, group).catch((e) => console.log(`group ${n}: ${e.message}`));
    n++;
  }
}

const table = (t) =>
  [
    "| Face size (as the app reads it) | Real faces | Vision didn't see it (0.10: thrown away) | Thrown away in 0.11 | Vision: very poor (thrown away) | Vision didn't answer |",
    "|---|---|---|---|---|---|",
    ...buckets.map(([, , label], i) => `| ${label} | ${t[i].faces} | ${t[i].unseen} | ${t[i].unseenNew} | ${t[i].poor} | ${t[i].visionFailed} |`),
  ].join("\n");
const report = `# Apple Vision second look: real faces thrown away

Each row counts real faces (the main face of a one-person photo, or every face of a made-up class photo) that the face finder kept, and how many of them Apple Vision then ruled out.

## One-person photos (${people.length} people, up to ${PER} photos each)

${table(single)}

## Made-up class photos (${n} photos, 24 faces each)

${table(group)}
`;
await writeFile(path.join(photos, "vision-report.md"), report);
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
