import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { heicPowerShell, source } from "./media";

test("Windows HEIC: the PowerShell script quotes paths with apostrophes and Arabic letters", () => {
  const ps = heicPowerShell("D:\\صور\\Sara's trip\\IMG_1.HEIC", "C:\\Temp\\o.jpg");
  assert.match(ps, /OpenRead\('D:\\صور\\Sara''s trip\\IMG_1\.HEIC'\)/);
  assert.match(ps, /Create\('C:\\Temp\\o\.jpg'\)/);
});

test("Windows HEIC: a file Windows can't read gives a clear message, never hangs", { skip: process.platform !== "win32" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-heic-test-"));
  const bad = path.join(dir, "broken.heic");
  execFileSync("powershell", ["-NoProfile", "-Command", `Set-Content -Path '${bad}' -Value 'not a photo'`]);
  assert.ok(existsSync(bad));
  await assert.rejects(source(bad), /HEIF Image Extensions/);
});
