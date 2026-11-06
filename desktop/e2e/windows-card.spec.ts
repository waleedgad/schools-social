import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
