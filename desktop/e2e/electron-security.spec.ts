import { _electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Electron's security guidelines, checked on the real app: the window can't
// reach the Mac except through the small "hub" bridge, can't load other
// pages or open windows, and gets only the permissions the app uses.
const root = path.join(__dirname, "..");

test("the app window is locked down (Electron security guidelines)", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  await expect(win.locator('button.nav[data-go="library"]')).toBeVisible({ timeout: 30_000 });

  // 1-4: isolation, sandbox, no Node in the page, no <webview>.
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()!;
    return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity, webviewTag: p.webviewTag, insecure: p.allowRunningInsecureContent };
  });
  expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false, insecure: false });
  const page = await win.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridge: Object.keys((window as unknown as { hub: object }).hub).sort(),
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "",
  }));
  expect(page.require).toBe("undefined");
  expect(page.process).toBe("undefined");
  expect(page.bridge).toEqual(["call", "on", "onCommand", "onProgress", "onState", "pathFor"]);
  // 7: a content security policy with no eval and no outside scripts.
  expect(page.csp).toContain("script-src 'self'");
  expect(page.csp).not.toMatch(/unsafe-eval|script-src[^;]*https?:/);

  // Only the app's own functions can be called.
  expect(await win.evaluate(() => (window as unknown as { hub: { call: (f: string) => Promise<unknown> } }).hub.call("constructor"))).toEqual({ ok: false, error: "unknown" });

  // 13-14: no new windows, no leaving the app's pages.
  const opened = await win.evaluate(() => window.open("http://example.com") === null);
  expect(opened).toBe(true);
  await win.evaluate(() => { location.href = "http://example.com/"; });
  await win.waitForTimeout(500);
  expect(win.url()).toMatch(/^file:/);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  // 5: permissions the app doesn't use are refused.
  const where = await win.evaluate(() => new Promise<string>((done) => navigator.geolocation.getCurrentPosition(() => done("allowed"), (e) => done(e.code === e.PERMISSION_DENIED ? "denied" : `error ${e.code}`))));
  expect(where).toBe("denied");
  const camera = await win.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(() => "allowed", (e: Error) => e.name));
  expect(camera).not.toBe("allowed");
  await app.close();
});
