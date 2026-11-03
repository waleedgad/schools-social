import { _electron, expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// B-22: an app set up before 0.5 saved the old web address; after the
// update it uses the school-facing one.
test("moves from the old web address to the new one", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  const file = path.join(userData, "settings.json");
  writeFileSync(file, JSON.stringify({ server: "https://schools-social.vercel.app", language: "en", setupDone: true, tourDone: true }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [path.join(__dirname, ".."), `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
  });
  await app.firstWindow();
  await expect.poll(() => JSON.parse(readFileSync(file, "utf8")).server).toBe("https://schoolsocialhub.seen-marketing.net");
  await app.close();
});
