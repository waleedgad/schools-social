// The website sends each page only the words its in-browser parts use
// (src/i18n/client-messages.json), not the whole dictionary: on a phone
// that is a third of the size. This fails the checks if a part that runs in
// the browser asks for words that aren't sent.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const sent = JSON.parse(readFileSync("src/i18n/client-messages.json", "utf8"));
const bad = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(p)) {
      const s = readFileSync(p, "utf8");
      if (!/^\s*["']use client["']/.test(s)) continue;
      if (/\buse(Messages|Formatter)\s*\(/.test(s)) bad.push(`${p}: uses the whole dictionary`);
      for (const m of s.matchAll(/\buseTranslations\s*\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g)) {
        const ns = m[1] ?? "";
        if (!ns || !sent.some((x) => ns === x || ns.startsWith(`${x}.`))) bad.push(`${p}: useTranslations("${ns}") is not in src/i18n/client-messages.json`);
      }
    }
  }
};
walk("src");
if (bad.length) {
  console.error(bad.join("\n"));
  process.exit(1);
}
console.log(`client words: ${sent.length} parts, every in-browser use covered`);
