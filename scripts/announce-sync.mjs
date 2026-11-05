// The Mac app draws announcements with the same code as the website. Its copy
// (desktop/src/renderer/announce.js) is made from src/lib/announce-draw.ts:
//   node scripts/announce-sync.mjs --write   makes the copy
//   node scripts/announce-sync.mjs           fails the checks if they differ
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const from = "src/lib/announce-draw.ts";
const to = "desktop/src/renderer/announce.js";
const out = ts.transpileModule(readFileSync(from, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const js = `// The announcement pack, the same drawing code as the website (${from}).\n${out.replace(/^export /gm, "")}`;
if (process.argv.includes("--write")) writeFileSync(to, js);
else if (readFileSync(to, "utf8") !== js) {
  console.error(`${to} is out of date with ${from}: run node scripts/announce-sync.mjs --write`);
  process.exit(1);
} else console.log("announcement drawing: Mac app and website match");
