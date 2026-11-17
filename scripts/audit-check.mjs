// Same rule as `npm audit --omit=dev --audit-level=high`, except for advisories listed below.
// Each exception needs a reason and a way out. Run from the folder that has the package.json.
import { spawnSync } from "node:child_process";

const ALLOWED = {
  // picomatch <= 4.0.7 (ReDoS), reached only through next-intl > @parcel/watcher, a file watcher used while developing.
  // No fixed picomatch version exists yet (4.0.7 is the latest). Allowed by Waleed on 17 Nov 2026.
  // REMOVE this line once one is published (check: npm view picomatch version; then npm update picomatch).
  "GHSA-fc5q-39xc-vjpf": "no fixed picomatch yet; dev-time file watcher only",
};

const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error("npm audit gave no readable answer:\n" + r.stdout + r.stderr);
  process.exit(1);
}
const bad = [];
const allowedSeen = new Set();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  if (!["high", "critical"].includes(v.severity)) continue;
  const advisories = v.via.filter((x) => typeof x === "object");
  if (!advisories.length) continue; // only depends on an affected package; the advisory is checked where it sits
  for (const a of advisories) {
    const id = String(a.url ?? "").split("/").pop();
    if (ALLOWED[id]) allowedSeen.add(id);
    else bad.push(`${v.name}: ${a.title} (${a.url}, ${a.severity})`);
  }
}
for (const id of allowedSeen) console.log(`allowed: ${id} - ${ALLOWED[id]}`);
if (bad.length) {
  console.error("Serious known security holes:\n" + bad.join("\n"));
  process.exit(1);
}
console.log("npm audit: no serious holes (apart from the allowed ones above)");
