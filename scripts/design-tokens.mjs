// Keeps the website and the Mac app on one set of colours (design/tokens.json).
//   node scripts/design-tokens.mjs          check: fails if either app drifts or a colour is too faint
//   node scripts/design-tokens.mjs --write  copy the colours from tokens.json into both apps
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(path.join(root, "design/tokens.json"), "utf8"));
const write = process.argv.includes("--write");
const problems = [];

// Each app's CSS: the light colours come before the dark marker, the dark ones after.
const apps = {
  website: { file: "src/app/globals.css", dark: "@media (prefers-color-scheme: dark)" },
  mac: { file: "desktop/src/renderer/styles.css", dark: ':root[data-theme="dark"] {' },
};

for (const [app, { file, dark }] of Object.entries(apps)) {
  const full = path.join(root, file);
  const css = readFileSync(full, "utf8");
  const at = css.indexOf(dark);
  if (at < 0) throw new Error(`${file}: dark section not found`);
  const parts = { light: css.slice(0, at), dark: css.slice(at) };
  for (const mode of ["light", "dark"]) {
    for (const [name, value] of Object.entries(tokens[mode])) {
      const cssName = tokens.names[app][name] ?? name;
      const re = new RegExp(`(--${cssName.replace(/[-]/g, "\\-")}:\\s*)(#[0-9a-fA-F]{3,8})`, "g");
      const found = [...parts[mode].matchAll(re)];
      if (!found.length) problems.push(`${app} ${mode}: --${cssName} missing`);
      for (const m of found) if (m[2].toLowerCase() !== value.toLowerCase()) problems.push(`${app} ${mode}: --${cssName} is ${m[2]}, should be ${value}`);
      if (write) parts[mode] = parts[mode].replace(re, `$1${value}`);
    }
  }
  if (write) writeFileSync(full, parts.light + parts.dark);
}

// WCAG 2.2 AA: normal text needs 4.5:1 against its background.
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
for (const mode of ["light", "dark"]) {
  for (const [fg, bg] of tokens.contrast) {
    const r = ratio(tokens[mode][fg], tokens[mode][bg]);
    if (r < 4.5) problems.push(`${mode}: ${fg} on ${bg} is ${r.toFixed(2)}:1 (needs 4.5)`);
  }
}

if (write) console.log("Colours copied into both apps.");
const left = write ? problems.filter((p) => /needs 4.5|missing/.test(p)) : problems;
if (left.length) {
  console.error(left.join("\n"));
  process.exit(1);
}
console.log("Website and Mac app use the same colours, all readable.");
