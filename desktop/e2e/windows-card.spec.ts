import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Release 0.7 (Windows): a memory card shows up as a drive letter (E:, F:...)
// with a DCIM folder. A folder made into a drive letter with "subst" stands
// in for the card. The app must find it, and checking every letter must
// never hold the app up.
test.skip(process.platform !== "win32", "Windows only");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };

test("a memory card on a drive letter is found", async () => {
  test.setTimeout(120_000);
  const letter = [..."QRSTUVWXYZ"].find((l) => !existsSync(`${l}:\\`));
  expect(letter, "a free drive letter").toBeTruthy();
  const card = mkdtempSync(path.join(tmpdir(), "hub-card-"));
  mkdirSync(path.join(card, "DCIM", "100CANON"), { recursive: true });
  writeFileSync(path.join(card, "DCIM", "100CANON", "IMG_0001.JPG"), "x");
  execFileSync("subst", [`${letter}:`, card]);
  try {
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true }));
    const app = await _electron.launch({ executablePath: require("electron") as unknown as string, args: [path.join(__dirname, ".."), `--user-data-dir=${userData}`] });
    const win = await app.firstWindow();
    await expect(win.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 20_000 });
    const t0 = Date.now();
    const vols = (await win.evaluate(() => (window as unknown as Hub).hub.call("volumes"))).value as { name: string; path: string }[];
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(vols.map((v) => v.name)).toContain(`${letter}:`);
    expect(vols.find((v) => v.name === `${letter}:`)!.path).toBe(`${letter}:\\DCIM`);
    await app.close();
  } finally {
    execFileSync("subst", [`${letter}:`, "/D"]);
  }
});

// 0.12 (Windows): a folder chosen on a card ("E:\DCIM\100CANON" through
// Choose folders) was not seen as the card, so no card name and no eject.
test("a folder chosen on a memory card counts as the card", async () => {
  test.setTimeout(120_000);
  const letter = [..."QRSTUVWXYZ"].find((l) => !existsSync(`${l}:\\`));
  expect(letter, "a free drive letter").toBeTruthy();
  const card = mkdtempSync(path.join(tmpdir(), "hub-card-"));
  mkdirSync(path.join(card, "DCIM", "100CANON"), { recursive: true });
  writeFileSync(path.join(card, "DCIM", "100CANON", "IMG_0001.JPG"), await sharp({ create: { width: 64, height: 48, channels: 3, background: "#468" } }).jpeg().toBuffer());
  execFileSync("subst", [`${letter}:`, card]);
  try {
    const lib = path.join(mkdtempSync(path.join(tmpdir(), "hub-lib-")), "Photos");
    mkdirSync(lib, { recursive: true });
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
    const app = await _electron.launch({ executablePath: require("electron") as unknown as string, args: [path.join(__dirname, ".."), `--user-data-dir=${userData}`], env: { ...process.env, HUB_TEST: "1" } });
    const win = await app.firstWindow();
    await expect(win.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 20_000 });
    // the letter written small, as Windows sometimes hands it over
    const r = await win.evaluate((d) => (window as unknown as Hub).hub.call("importChoose", [d]), `${letter.toLowerCase()}:\\DCIM\\100CANON`);
    expect(r.ok).toBe(true);
    const { id } = r.value as { id: string };
    const scan = (await win.evaluate((i) => (window as unknown as Hub).hub.call("importScan", i), id)).value as { kind: string; volume: string | null };
    expect(scan.kind).toBe("card");
    expect(scan.volume).toBe(`${letter}:\\`);
    await app.close();
  } finally {
    execFileSync("subst", [`${letter}:`, "/D"]);
  }
});

// 0.12 (Windows): photos moved to an archive drive with its own letter were
// marked missing every time the library was checked again, because Windows
// gives no ".." between two drives.
test("photos on the archive drive are not missing after the library is checked again", async () => {
  test.setTimeout(180_000);
  const letter = [..."QRSTUVWXYZ"].reverse().find((l) => !existsSync(`${l}:\\`));
  expect(letter, "a free drive letter").toBeTruthy();
  const archiveDisk = mkdtempSync(path.join(tmpdir(), "hub-archive-"));
  execFileSync("subst", [`${letter}:`, archiveDisk]);
  try {
    const lib = path.join(mkdtempSync(path.join(tmpdir(), "hub-lib-")), "Photos");
    const event = path.join(lib, "2022-2023", "Term 1", "2022-10-12 Sports day");
    mkdirSync(event, { recursive: true });
    for (let i = 0; i < 3; i++) writeFileSync(path.join(event, `IMG_${1000 + i}.jpg`), await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 60 * i, g: 120, b: 90 } } }).jpeg().toBuffer());
    const archive = `${letter}:\\Archive`;
    mkdirSync(archive, { recursive: true });
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: lib, archive, faces: false }));
    const app = await _electron.launch({ executablePath: require("electron") as unknown as string, args: [path.join(__dirname, ".."), `--user-data-dir=${userData}`], env: { ...process.env, HUB_TEST: "1" } });
    const win = await app.firstWindow();
    const call = (f: string, ...a: unknown[]) => win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
    await win.locator('button.nav[data-go="library"]').click();
    await expect(win.locator("#grid .tile, #grid [data-id]")).toHaveCount(3, { timeout: 60_000 });
    const moved = await call("archiveMove", ["2022-2023"]);
    expect(moved.ok).toBe(true);
    expect((moved.value as { moved: number }).moved).toBe(3);
    await call("rescan");
    await call("rescan");
    await expect(win.locator("#missingbar")).toBeEmpty({ timeout: 15_000 });
    expect((await call("missingCount")).value).toBe(0);
    await win.screenshot({ path: test.info().outputPath("archive-other-drive.png") });
    await app.close();
  } finally {
    execFileSync("subst", [`${letter}:`, "/D"]);
  }
});
