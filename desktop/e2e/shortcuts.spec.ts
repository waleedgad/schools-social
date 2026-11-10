import { _electron, expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// The keyboard shortcut map (doc "Keyboard shortcuts for the Mac and
// Windows app"): ⌘ on the Mac, Ctrl on Windows; Esc always closes the photo
// view, even while a photo is still loading; ⌘D selects none; letters follow
// the key, so they work with the Arabic keyboard on; ⌘/ shows every key; no
// screen has two actions on one key; nothing fires while typing.
const root = path.join(__dirname, "..");
const mac = process.platform === "darwin";
const mod = mac ? "Meta" : "Control";
type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value: unknown }> } };
const call = async (win: Page, f: string, ...a: unknown[]) => {
  const r = await win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
  if (!r.ok) throw new Error(`${f}: ${JSON.stringify(r)}`);
  return r.value;
};
const photo = (seed: number) =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: { r: (seed * 40) % 255, g: (seed * 90) % 255, b: (seed * 150) % 255 } } })
    .composite([{ input: Buffer.from(`<svg width="400" height="300"><circle cx="${50 + seed * 40}" cy="150" r="40" fill="white"/></svg>`) }])
    .jpeg()
    .toBuffer();

// What an Arabic keyboard sends: the Arabic letter, on the key marked P.
const arabicKey = (win: Page, key: string, code: string, opts: { shift?: boolean; meta?: boolean; ctrl?: boolean } = {}) =>
  win.evaluate(([key, code, o]) => {
    const t = document.activeElement ?? document.body;
    t.dispatchEvent(new KeyboardEvent("keydown", { key, code, shiftKey: !!o.shift, metaKey: !!o.meta, ctrlKey: !!o.ctrl, bubbles: true, cancelable: true }));
  }, [key, code, opts] as const);

async function start(language: "en" | "ar") {
  const base = mkdtempSync(path.join(tmpdir(), "hub-keys-"));
  const lib = path.join(base, "Photos");
  const ev = path.join(lib, "2026-2027", "Term 1", "2026-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  const shots = await Promise.all([1, 2, 3, 4, 5, 6].map(photo));
  shots.forEach((b, i) => writeFileSync(path.join(ev, `IMG_000${i + 1}.jpg`), b));
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language, setupDone: true, tourDone: true, wizard: true, library: lib, faces: false }));
  const volumes = path.join(base, "Volumes");
  mkdirSync(volumes);
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1", HUB_VOLUMES: volumes },
  });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on("pageerror", (e) => errors.push(e.message));
  await expect(win.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr", { timeout: 30_000 });
  // Keys pressed before the window has its first state do nothing, as for a person.
  await expect.poll(() => win.evaluate("!!S && !!document.querySelector('#side .nav')"), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => ((await call(win, "photos", {})) as unknown[]).length, { timeout: 90_000 }).toBe(6);
  await expect.poll(async () => ((await call(win, "state")) as { engine?: { processing?: number } }).engine?.processing ?? 0, { timeout: 60_000 }).toBe(0);
  return { app, win, errors };
}

const view = (win: Page) => win.evaluate("App.view");
const selected = (win: Page) => win.evaluate("lib.sel.size") as Promise<number>;
const viewerOpen = (win: Page) => win.locator("#overlay .viewer").count();

for (const language of ["en", "ar"] as const) {
  test(`keyboard shortcut map (${language})`, async () => {
    test.setTimeout(240_000);
    const { app, win, errors } = await start(language);

    // Tabs by number, on the Mac too (⌘6 to ⌘9 are new).
    for (const [n, name] of [["6", "calendar"], ["7", "books"], ["8", "coverage"], ["9", "cleanup"], ["4", "students"], ["2", "library"]] as const) {
      await win.locator("body").press(`${mod}+${n}`);
      await expect.poll(() => view(win), { message: `${mod}+${n}` }).toBe(name);
    }
    // Back and forward between screens.
    await win.locator("body").press(`${mod}+,`);
    await expect.poll(() => view(win)).toBe("settings");
    if (mac) await win.locator("body").press("Meta+BracketLeft");
    else await win.keyboard.press(language === "ar" ? "Alt+ArrowRight" : "Alt+ArrowLeft");
    await expect.poll(() => view(win), { message: "back" }).toBe("library");
    if (mac) await win.locator("body").press("Meta+BracketRight");
    else await win.keyboard.press(language === "ar" ? "Alt+ArrowLeft" : "Alt+ArrowRight");
    await expect.poll(() => view(win), { message: "forward" }).toBe("settings");
    await win.locator("body").press(`${mod}+2`);
    await expect(win.locator(".tile")).toHaveCount(6, { timeout: 30_000 });

    // Selecting: all, none (⌘D and ⇧⌘A), invert, Esc.
    await win.locator(".tile").first().click();
    await expect.poll(() => selected(win)).toBe(1);
    await win.keyboard.press(`${mod}+a`);
    await expect.poll(() => selected(win), { message: "select all" }).toBe(6);
    await win.keyboard.press(`${mod}+d`);
    await expect.poll(() => selected(win), { message: "select none" }).toBe(0);
    await win.keyboard.press(`${mod}+a`);
    await win.keyboard.press(`${mod}+Shift+a`);
    await expect.poll(() => selected(win), { message: "shift select none" }).toBe(0);
    await win.keyboard.press(`${mod}+Alt+a`);
    await expect.poll(() => selected(win), { message: "invert" }).toBe(6);
    await win.keyboard.press("Escape");
    await expect.poll(() => selected(win), { message: "Esc" }).toBe(0);
    await win.keyboard.press("End");
    await expect.poll(() => win.evaluate("lib.focus")).toBe(5);
    await win.keyboard.press("Home");
    await expect.poll(() => win.evaluate("lib.focus")).toBe(0);

    // Arabic keyboard: the key marked P picks, the key marked 4 gives 4 stars.
    const first = (await win.evaluate("lib.shown[0].id")) as number;
    await arabicKey(win, "ح", "KeyP");
    await expect.poll(async () => ((await call(win, "photo", first)) as { flag: number }).flag, { message: "Arabic P" }).toBe(1);
    await arabicKey(win, "٤", "Digit4");
    await expect.poll(async () => ((await call(win, "photo", first)) as { rating: number }).rating, { message: "Arabic 4" }).toBe(4);
    await arabicKey(win, "ش", "KeyA", mac ? { meta: true } : { ctrl: true });
    await expect.poll(() => selected(win), { message: "Arabic ⌘A" }).toBe(6);
    await arabicKey(win, "ي", "KeyD", mac ? { meta: true } : { ctrl: true });
    await expect.poll(() => selected(win), { message: "Arabic ⌘D" }).toBe(0);

    // Nothing fires while typing: P typed in the search box doesn't pick.
    await win.locator(".tile").nth(1).click();
    const second = (await win.evaluate("lib.shown[1].id")) as number;
    await win.keyboard.press(`${mod}+k`);
    await expect(win.locator(".palette input")).toBeFocused();
    await win.keyboard.type("px3");
    await win.keyboard.press("Escape");
    await expect(win.locator(".palette")).toHaveCount(0);
    const p2 = (await call(win, "photo", second)) as { flag: number; rating: number };
    expect([p2.flag, p2.rating], "typing in a box changes no photo").toEqual([0, 0]);

    // The photo view: Esc closes it even while the photo is still loading
    // (straight after opening, and straight after moving on).
    for (const keys of [["Enter", "Escape"], ["Enter", "ArrowRight", "Escape"], ["Enter", "ArrowRight", "ArrowRight", "Escape"]]) {
      for (const k of keys) await win.keyboard.press(k);
      await win.waitForTimeout(1200);
      expect(await viewerOpen(win), `photo view closed after ${keys.join(" ")}`).toBe(0);
      await expect.poll(() => win.evaluate("App.overlayKeys === null"), { message: "no keys left over" }).toBe(true);
    }
    await win.keyboard.press("Home");
    await win.keyboard.press("Enter");
    await expect(win.locator("#overlay .viewer")).toBeVisible();
    await win.keyboard.press("End");
    await expect.poll(() => win.evaluate("V.photo?.id === V.ids[5]")).toBe(true);
    await win.keyboard.press("Home");
    await expect.poll(() => win.evaluate("V.photo?.id === V.ids[0]")).toBe(true);
    const shown0 = (await win.evaluate("V.ids[0]")) as number;
    await call(win, "flag", [shown0], 0);
    await call(win, "rate", [shown0], 0);
    await win.keyboard.press("Home"); // draws it again with the fresh state
    await expect.poll(() => win.evaluate("V.photo?.flag === 0 && !V.photo?.rating")).toBe(true);
    const state = async () => { const p = (await call(win, "photo", shown0)) as { flag: number; rating: number }; return [p.flag, p.rating]; };
    await win.keyboard.press("p");
    await win.keyboard.press("3");
    await expect.poll(state, { message: "P and 3 in the photo view" }).toEqual([1, 3]);
    await win.keyboard.press("u");
    await win.keyboard.press("0");
    await expect.poll(state, { message: "U and 0 in the photo view" }).toEqual([0, 0]);
    await arabicKey(win, "ء", "KeyX");
    await expect.poll(state, { message: "Arabic X in the photo view" }).toEqual([-1, 0]);
    // ⌘/ over the photo view lists its keys; Esc goes back to the photo.
    await win.keyboard.press(`${mod}+Slash`);
    await expect(win.locator(".keysheet").first()).toBeVisible();
    const sheet = await win.locator("#overlay").innerText();
    expect(sheet).toContain(mac ? "⌘" : "Ctrl+");
    expect(sheet).toContain("Home");
    await win.keyboard.press("Escape");
    await expect(win.locator("#overlay .viewer")).toBeVisible();
    await expect.poll(() => win.evaluate("V.i")).toBe(0);
    // ⌘⌫ (Delete on Windows): asks, Cancel keeps the photo and the view.
    await win.keyboard.press(mac ? "Meta+Backspace" : "Delete");
    await expect(win.locator(".modal [data-no]")).toBeVisible();
    await win.locator(".modal [data-no]").click();
    await expect(win.locator("#overlay .viewer")).toBeVisible();
    await win.keyboard.press("Escape");
    await expect(win.locator("#overlay .viewer")).toHaveCount(0);

    // ⌘/ in the grid: the selection keys are listed, in the computer's words.
    await win.keyboard.press(`${mod}+Slash`);
    const grid = await win.locator("#overlay").innerText();
    expect(grid).toMatch(mac ? /⌘\s*D/ : /Ctrl\+D/);
    if (!mac) expect(grid).not.toContain("⌘");
    await win.keyboard.press("Escape");
    await expect(win.locator(".keysheet")).toHaveCount(0);
    // And with the Arabic keyboard: Shift + the / key (؟) opens it too.
    await arabicKey(win, "؟", "Slash", { shift: true });
    await expect(win.locator(".keysheet").first()).toBeVisible();
    await win.keyboard.press("Escape");

    // No screen lists one key twice.
    const clashes = (await win.evaluate(`(() => {
      const lists = [...Object.entries(App.views).map(([n, v]) => [n, v.keys?.() ?? []]), ["viewer", viewerKeyList()]];
      return lists.flatMap(([n, rows]) => {
        const seen = new Map();
        rows.forEach(([k]) => seen.set(k, (seen.get(k) ?? 0) + 1));
        return [...seen].filter(([, c]) => c > 1).map(([k]) => n + ": " + k);
      });
    })()`)) as string[];
    expect(clashes).toEqual([]);
    expect(errors).toEqual([]);
    await app.close();
  });
}
