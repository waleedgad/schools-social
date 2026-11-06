// Downloads the stand-in face test photos from Wikimedia Commons.
//   node bench/faces/fetch.mjs <out-dir> [per-person=25]
// Keeps only photos whose licence allows commercial use (CC0, public domain,
// CC BY, CC BY-SA; never NC or ND), and writes credits.json with the author,
// licence and source page of every photo. Nothing is stored in the repository.
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? "face-bench-photos");
const perPerson = Number(process.argv[3] ?? 25);
const { people } = JSON.parse(await readFile(path.join(here, "people.json"), "utf8"));
const API = "https://commons.wikimedia.org/w/api.php";
const UA = "SchoolSocialHub-face-bench/1.0 (https://github.com/waleedgad/schools-social; automated test)";
const OK_LICENCE = /^(cc0|cc-zero|public domain|pd|cc[ -]by(-sa)?[ -]?\d)/i;
const BAD_LICENCE = /\b(nc|nd)\b|non-?commercial|no ?deriv/i;

export const slug = (name) => name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (html) => String(html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let tries = 0; ; tries++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (tries >= 4) throw new Error(`commons ${res.status}`);
    await sleep(2000 * 2 ** tries);
  }
}

async function filesIn(category) {
  const files = [];
  let cont = {};
  for (let page = 0; page < 3; page++) {
    const j = await api({
      action: "query",
      generator: "categorymembers",
      gcmtitle: `Category:${category}`,
      gcmtype: "file",
      gcmlimit: "100",
      prop: "imageinfo",
      iiprop: "url|extmetadata|mime|size",
      iiurlwidth: "1000",
      ...cont,
    });
    for (const p of j.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii || ii.mime !== "image/jpeg" || ii.width < 500) continue;
      const m = ii.extmetadata ?? {};
      const licence = strip(m.LicenseShortName?.value);
      if (!OK_LICENCE.test(licence) || BAD_LICENCE.test(licence)) continue;
      files.push({ title: p.title, url: ii.thumburl ?? ii.url, page: ii.descriptionurl, licence, author: strip(m.Artist?.value) || "unknown" });
    }
    if (!j.continue) break;
    cont = j.continue;
  }
  return files;
}

async function subcats(category) {
  const j = await api({ action: "query", list: "categorymembers", cmtitle: `Category:${category}`, cmtype: "subcat", cmlimit: "50" });
  return (j.query?.categorymembers ?? []).map((c) => c.title.replace(/^Category:/, ""));
}

async function exists(f) {
  try {
    return (await stat(f)).size > 0;
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const credits = [];
  const short = [];
  for (const name of people) {
    const dir = path.join(out, slug(name));
    await mkdir(dir, { recursive: true });
    let files = [];
    try {
      files = await filesIn(name);
      // Many people keep most photos in sub-categories ("X in 2019", "Portraits of X").
      if (files.length < perPerson) {
        const surname = name.split(" ").at(-1).toLowerCase();
        for (const sub of (await subcats(name)).filter((s) => s.toLowerCase().includes(surname)).slice(0, 8)) {
          files.push(...(await filesIn(sub)));
          if (files.length >= perPerson * 2) break;
        }
      }
    } catch (e) {
      console.log(`${name}: ${e.message}`);
    }
    // Same order every run, so the test is repeatable.
    const seen = new Set();
    files = files.filter((f) => !seen.has(f.title) && seen.add(f.title)).sort((a, b) => a.title.localeCompare(b.title)).slice(0, perPerson);
    let got = 0;
    for (const [i, f] of files.entries()) {
      const file = path.join(dir, `${String(i).padStart(2, "0")}.jpg`);
      if (!(await exists(file))) {
        try {
          const res = await fetch(f.url, { headers: { "User-Agent": UA } });
          if (!res.ok) throw new Error(String(res.status));
          await writeFile(file, Buffer.from(await res.arrayBuffer()));
          await sleep(150);
        } catch (e) {
          console.log(`  ${f.title}: ${e.message}`);
          continue;
        }
      }
      got++;
      credits.push({ person: name, file: path.relative(out, file), ...f });
    }
    if (got < 8) short.push(`${name} (${got})`);
    console.log(`${name}: ${got} photos`);
  }
  await writeFile(path.join(out, "credits.json"), JSON.stringify(credits, null, 1));
  console.log(`\n${credits.length} photos of ${people.length - short.length} people with 8+ photos.`);
  if (short.length) console.log(`Too few photos: ${short.join(", ")}`);
}
