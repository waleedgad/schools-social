// Windows update robot test (quality plan, Phase 3: updates that never break
// the library). Builds the app twice (this version and a pretend next one),
// installs the first like a school would, points it at a small local update
// server holding the second, and checks that:
//   - it downloads the update and makes a safety copy of the library first,
//   - it installs itself, and the installed app is now the new version,
//   - the library (photos list, names, settings) is still there.
// Runs on GitHub's Windows computer: node scripts/update-test.mjs
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("update test: Windows only (the Mac updates itself once signed)");
  process.exit(0);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgFile = path.join(root, "package.json");
const pkgText = readFileSync(pkgFile, "utf8");
const pkg = JSON.parse(pkgText);
const [a, b, c] = pkg.version.split(".").map(Number);
const next = `${a}.${b}.${c + 1}`;
const PORT = 8765;
const feed = `http://127.0.0.1:${PORT}/`;
const name = "School Social Hub Library";
const sh = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false", ...env } });
const fail = (m) => {
  console.error(`update test FAILED: ${m}`);
  process.exit(1);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await wait(1000);
  }
  fail(`timed out waiting for: ${what}`);
}

// 1. Build this version and the next one (same code, higher number).
sh("npm", ["run", "build"]);
const oldDir = path.join(root, "release-old");
const newDir = path.join(root, "release-new");
rmSync(oldDir, { recursive: true, force: true });
rmSync(newDir, { recursive: true, force: true });
sh("npx", ["electron-builder", "--win", "nsis", "--publish", "never", `-c.directories.output=release-old`]);
try {
  writeFileSync(pkgFile, JSON.stringify({ ...pkg, version: next }, null, 2) + "\n");
  // Same settings, but published to the local test server instead of GitHub.
  const yml = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  const testYml = yml.replace(/^publish:[\s\S]*?(?=^\S|(?![\s\S]))/m, `publish:\n  provider: generic\n  url: ${feed}\n`);
  if (!testYml.includes("provider: generic")) fail("couldn't point the test build at the test server");
  writeFileSync(path.join(root, "electron-builder.update-test.yml"), testYml);
  sh("npx", ["electron-builder", "--config", "electron-builder.update-test.yml", "--win", "nsis", "--publish", "never", `-c.directories.output=release-new`]);
} finally {
  writeFileSync(pkgFile, pkgText);
  rmSync(path.join(root, "electron-builder.update-test.yml"), { force: true });
}
const setup = readdirSync(oldDir).find((f) => f.endsWith(".exe"));
if (!setup) fail("no installer built");
if (!existsSync(path.join(newDir, "latest.yml"))) fail("the new version has no latest.yml");

// 2. A small update server, like the real download place will be.
const served = [];
const server = http
  .createServer((req, res) => {
    const file = path.join(newDir, decodeURIComponent(new URL(req.url, feed).pathname).replace(/^\/+/, ""));
    served.push(path.basename(file));
    if (!file.startsWith(newDir) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
    res.writeHead(200, { "content-length": statSync(file).size });
    createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1");

// 3. Install the current version, quietly, like a school would.
const installDir = mkdtempSync(path.join(tmpdir(), "hub-install-"));
execFileSync(path.join(oldDir, setup), ["/S", `/D=${installDir}`], { stdio: "inherit" });
const exe = path.join(installDir, `${name}.exe`);
await until("the app to be installed", () => existsSync(exe), 120_000);
const version = () => execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Item '${exe}').VersionInfo.ProductVersion`]).toString().trim();
console.log(`installed ${version()} in ${installDir}`);
if (!version().startsWith(pkg.version)) fail(`installed version is ${version()}, not ${pkg.version}`);

// 4. A library with photos, names and settings.
const userData = mkdtempSync(path.join(tmpdir(), "hub-user-"));
const lib = path.join(userData, "Photos", "2026-2027", "Term 1", "2026-10-12 Sports day");
mkdirSync(lib, { recursive: true });
// A tiny real JPEG (1x1).
const jpg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
for (let i = 0; i < 3; i++) writeFileSync(path.join(lib, `IMG_${i}.jpg`), jpg);
writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: path.join(userData, "Photos"), faces: false, schoolName: "Update Test School" }));
const logFile = path.join(userData, "app.log");
const logText = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");

// 5. Start it: it finds the update, makes a safety copy, installs and closes.
const run = spawn(exe, [`--user-data-dir=${userData}`], { env: { ...process.env, HUB_UPDATE_FEED: feed, HUB_UPDATE_TEST: "1" }, stdio: "ignore", detached: true });
run.unref();
await until("the update to download", () => logText().includes(`update ${next} downloaded`), 180_000);
const backups = path.join(userData, "backups");
const copy = existsSync(backups) ? readdirSync(backups).find((d) => d.startsWith(`before-${next}`)) : null;
if (!copy || !existsSync(path.join(backups, copy, "library.db"))) fail("no safety copy of the library was made before updating");
console.log(`safety copy: ${copy}`);
await until(`the installed app to become ${next}`, () => {
  try {
    return version().startsWith(next);
  } catch {
    return false; // being replaced right now
  }
}, 240_000);
console.log(`now installed: ${version()}`);

// 6. The new version opens the same library and keeps everything.
// (The installer may have started it again already: close every copy first.)
const killAll = () => {
  try {
    execFileSync("taskkill", ["/IM", `${name}.exe`, "/T", "/F"], { stdio: "ignore" });
  } catch {
    // none running
  }
};
killAll();
await wait(3000);
const again = spawn(exe, [`--user-data-dir=${userData}`], { env: { ...process.env, HUB_UPDATE_FEED: "http://127.0.0.1:1/" }, stdio: "ignore", detached: true });
again.unref();
await until(`version ${next} to start`, () => logText().includes(`started ${next}`), 120_000);
await wait(8000);
const { DatabaseSync } = await import("node:sqlite");
const photos = (file) => {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    return d.prepare("select count(*) n from photos").get().n;
  } finally {
    d.close();
  }
};
const inCopy = photos(path.join(backups, copy, "library.db"));
const now = photos(path.join(userData, "library.db"));
console.log(`photos: ${inCopy} in the safety copy, ${now} after the update`);
if (inCopy < 3 || now < inCopy) fail("photos were lost in the update");
const settings = JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8"));
if (settings.schoolName !== "Update Test School" || !settings.library) fail("settings were lost in the update");
killAll();
server.close();

// 7. Uninstalling removes the app but never the school's library, names or faces.
await wait(2000);
const appData = path.join(process.env.APPDATA ?? "", name);
mkdirSync(appData, { recursive: true });
const keep = path.join(appData, "uninstall-test-keep.txt");
writeFileSync(keep, "the library lives here");
const uninstaller = readdirSync(installDir).find((f) => /^Uninstall .*\.exe$/i.test(f));
if (!uninstaller) fail("no uninstaller was installed");
execFileSync(path.join(installDir, uninstaller), ["/S"], { stdio: "inherit" });
await until("the app to be uninstalled", () => !existsSync(exe), 120_000);
if (!existsSync(keep)) fail("uninstalling deleted the app's data folder (library, names, faces)");
if (!existsSync(path.join(userData, "library.db"))) fail("uninstalling deleted the library");
rmSync(keep, { force: true });
console.log("uninstalled; the library and the app's data folder are still there");
console.log(`update test passed: ${pkg.version} -> ${next}, safety copy made, settings kept, uninstall keeps the library (server sent: ${[...new Set(served)].join(", ")})`);
// Keep the build folders out of the way of later steps.
for (const d of [oldDir, newDir]) renameSync(d, `${d}-done-${Date.now()}`);
process.exit(0);
