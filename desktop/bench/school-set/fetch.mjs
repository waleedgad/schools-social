// Downloads the photos for the realistic test school (school.json) from
// Wikimedia Commons.
//   node bench/school-set/fetch.mjs <out-dir> [per-person=20]
// Writes <out>/people/<id>/NN.jpg, <out>/groups/<class>/NN.jpg and
// <out>/credits.json (author, licence and source page of every photo).
// Only licences that allow commercial use are kept (CC0, public domain,
// CC BY, CC BY-SA; never NC or ND). Nothing is stored in the repository.
// RAW camera files (NASA ISS photos, public domain) come from the rawpy
// project's test folder.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const API = "https://commons.wikimedia.org/w/api.php";
const UA = "SchoolSocialHub-test-set/1.0 (https://github.com/waleedgad/schools-social; automated test)";
const OK_LICENCE = /^(cc0|cc-zero|public domain|pd|cc[ -]by(-sa)?[ -]?\d)/i;
const BAD_LICENCE = /\b(nc|nd)\b|non-?commercial|no ?deriv/i;
export const RAW_FILES = [
  { name: "iss030e122639.NEF", url: "https://raw.githubusercontent.com/letmaik/rawpy/main/test/iss030e122639.NEF", licence: "Public domain (NASA)", page: "https://github.com/letmaik/rawpy/tree/main/test" },
  { name: "iss042e297200.NEF", url: "https://raw.githubusercontent.com/letmaik/rawpy/main/test/iss042e297200.NEF", licence: "Public domain (NASA)", page: "https://github.com/letmaik/rawpy/tree/main/test" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (html) => String(html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
const exists = async (f) => (await stat(f).catch(() => null))?.size > 0;

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let tries = 0; ; tries++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
    if (res?.ok) return res.json();
    if (tries >= 4) throw new Error(`commons ${res?.status ?? "offline"}`);
    await sleep(2000 * 2 ** tries);
  }
}

function keep(pages) {
  const files = [];
  for (const p of pages ?? []) {
    const ii = p.imageinfo?.[0];
    if (!ii || ii.mime !== "image/jpeg" || ii.width < 600) continue;
    const m = ii.extmetadata ?? {};
    const licence = strip(m.LicenseShortName?.value);
    if (!OK_LICENCE.test(licence) || BAD_LICENCE.test(licence)) continue;
    files.push({ title: p.title, url: ii.thumburl ?? ii.url, page: ii.descriptionurl, licence, author: strip(m.Artist?.value) || "unknown", width: ii.width, height: ii.height });
  }
  return files;
}

const INFO = { prop: "imageinfo", iiprop: "url|extmetadata|mime|size", iiurlwidth: "2000" };

async function filesIn(category, pages = 2) {
  const files = [];
  let cont = {};
  for (let page = 0; page < pages; page++) {
    const j = await api({ action: "query", generator: "categorymembers", gcmtitle: `Category:${category}`, gcmtype: "file", gcmlimit: "100", ...INFO, ...cont });
    files.push(...keep(j.query?.pages));
    if (!j.continue) break;
    cont = j.continue;
  }
  return files;
}

async function filesNamed(name) {
  const j = await api({ action: "query", generator: "search", gsrsearch: `intitle:"${name}" filetype:bitmap`, gsrnamespace: "6", gsrlimit: "60", ...INFO });
  return keep(j.query?.pages);
}

async function subcats(category) {
  const j = await api({ action: "query", list: "categorymembers", cmtitle: `Category:${category}`, cmtype: "subcat", cmlimit: "50" });
  return (j.query?.categorymembers ?? []).map((c) => c.title.replace(/^Category:/, ""));
}

// The first category name that exists, else the best category search hit.
async function resolveCategory(p) {
  for (const c of p.commons ?? []) {
    const j = await api({ action: "query", titles: `Category:${c}`, prop: "categoryinfo" });
    const page = j.query?.pages?.[0];
    if (page && !page.missing && (page.categoryinfo?.files ?? 0) + (page.categoryinfo?.subcats ?? 0) > 0) return c;
  }
  const surname = p.search.split(" ").at(-1).toLowerCase();
  const j = await api({ action: "query", list: "search", srsearch: p.search, srnamespace: "14", srlimit: "10" });
  const hit = (j.query?.search ?? []).map((s) => s.title.replace(/^Category:/, "")).find((t) => t.toLowerCase().includes(surname));
  return hit ?? null;
}

// Portraits first (they become the class-list portrait), then the photos
// whose title names the person, then the rest; same order every run.
function order(files, name) {
  const seen = new Set();
  const surname = name.split(" ").at(-1).toLowerCase();
  const rank = (f) => (/portrait/i.test(f.title) ? 0 : f.title.toLowerCase().includes(surname) ? 1 : 2);
  return files.filter((f) => !seen.has(f.title) && seen.add(f.title)).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

async function download(url, file) {
  if (await exists(file)) return true;
  for (let tries = 0; tries < 5; tries++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
    if (res && (res.status === 429 || res.status >= 500)) {
      await sleep(Number(res.headers.get("retry-after") ?? 0) * 1000 || 3000 * 2 ** tries);
      continue;
    }
    if (!res?.ok) return false;
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    await sleep(200);
    return true;
  }
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? "school-set-photos");
  const perPerson = Number(process.argv[3] ?? 20);
  const school = JSON.parse(await readFile(path.join(here, "school.json"), "utf8"));
  const everyone = [...school.classes.flatMap((c) => c.students), ...school.teachers];
  const credits = [];
  const report = [];
  for (const p of everyone) {
    const dir = path.join(out, "people", p.id);
    await mkdir(dir, { recursive: true });
    let files = [];
    let category = null;
    try {
      category = await resolveCategory(p);
      files = [...(await filesNamed(p.search))];
      if (category) {
        files.push(...(await filesIn(category)));
        const surname = p.search.split(" ").at(-1).toLowerCase();
        for (const sub of (await subcats(category)).filter((s) => s.toLowerCase().includes(surname)).slice(0, 6)) {
          if (files.length >= perPerson * 3) break;
          files.push(...(await filesIn(sub, 1)));
        }
      }
    } catch (e) {
      console.log(`${p.id} ${p.search}: ${e.message}`);
    }
    files = order(files, p.search).slice(0, perPerson);
    let got = 0;
    for (const [i, f] of files.entries()) {
      const file = path.join(dir, `${String(i).padStart(2, "0")}.jpg`);
      if (!(await download(f.url, file))) continue;
      got++;
      credits.push({ person: p.id, file: path.relative(out, file), ...f });
    }
    report.push({ id: p.id, search: p.search, category, photos: got });
    console.log(`${p.id} ${p.search} [${category ?? "no category"}]: ${got} photos`);
  }
  // Whole-class photos (the astronaut class's group pictures).
  for (const c of school.classes) {
    const dir = path.join(out, "groups", c.name);
    await mkdir(dir, { recursive: true });
    let files = [];
    try {
      files = order(await filesIn(c.groupCategory), "group").slice(0, 12);
    } catch (e) {
      console.log(`${c.name} groups: ${e.message}`);
    }
    let got = 0;
    for (const [i, f] of files.entries()) {
      const file = path.join(dir, `${String(i).padStart(2, "0")}.jpg`);
      if (!(await download(f.url, file))) continue;
      got++;
      credits.push({ group: c.name, file: path.relative(out, file), ...f });
    }
    report.push({ id: `group ${c.name}`, category: c.groupCategory, photos: got });
    console.log(`group ${c.name} [${c.groupCategory}]: ${got} photos`);
  }
  await mkdir(path.join(out, "raw"), { recursive: true });
  for (const r of RAW_FILES) {
    const ok = await download(r.url, path.join(out, "raw", r.name));
    console.log(`raw ${r.name}: ${ok ? "ok" : "failed"}`);
    if (ok) credits.push({ raw: true, file: `raw/${r.name}`, title: r.name, url: r.url, page: r.page, licence: r.licence, author: "NASA" });
  }
  await writeFile(path.join(out, "credits.json"), JSON.stringify(credits, null, 1));
  await writeFile(path.join(out, "fetch-report.json"), JSON.stringify(report, null, 1));
  const short = report.filter((r) => r.photos < 8);
  console.log(`\n${credits.length} files. People/groups with fewer than 8 photos: ${short.map((r) => `${r.id} ${r.search ?? ""} (${r.photos})`).join(", ") || "none"}`);
}
