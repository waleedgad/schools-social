// Lays the stand-in photos (bench/faces/fetch.mjs, well-known adults from
// Wikimedia Commons) out like a school's test folder, so run.mjs can be
// checked before the school's own photos arrive. GitHub runs only.
//   node bench/real-faces/make-stand-in.mjs <stand-in photos> <test folder> [per-person=15]
// 3 classes of up to 20 people with a made-up ID each, 10 more people as
// "Not in list". Photos are linked, not copied. Unlike bench/faces/run.mjs
// nothing is cleaned: a photo filed under the wrong person on Commons
// counts against us, as a mislabelled photo from a school would.
import { readdir, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const [from, to] = process.argv.slice(2).map((p) => path.resolve(p));
const per = Number(process.argv[4] ?? 15);
await rm(to, { recursive: true, force: true });
const dirs = (await readdir(from, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== "groups").map((d) => d.name).sort();
const people = [];
for (const d of dirs) {
  const files = (await readdir(path.join(from, d))).filter((f) => /\.jpe?g$/i.test(f)).sort();
  if (files.length >= 10) people.push({ d, files: files.slice(0, per) });
}
const classes = ["9A", "10B", "11C"];
const rows = ["Student ID,Name,Class"];
let n = 0;
for (const p of people.slice(0, 70)) {
  const i = n++;
  const inList = i < 60;
  const dir = inList ? path.join(to, "Students", p.d) : path.join(to, "Not in list", p.d);
  await mkdir(dir, { recursive: true });
  for (const f of p.files) await symlink(path.join(from, p.d, f), path.join(dir, f));
  if (inList) rows.push(`${5000 + i},${p.d.replace(/-/g, " ")},${classes[i % 3]}`);
}
await writeFile(path.join(to, "class list.csv"), rows.join("\n") + "\n");
console.log(`${Math.min(n, 60)} people in the list, ${Math.max(0, n - 60)} not in it, up to ${per} photos each`);
