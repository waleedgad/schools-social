import { _electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Help in the app has a guide for each feature added in 0.13 to 0.17, in
// English and Arabic, and none of them says child or children.
const root = path.join(__dirname, "..");
const GUIDES = { books: "Yearbooks", graduation: "Graduation", look: "Easier reading", captions: "AI captions", plan: "Your plan and this computer", website: "On the website" };
const GUIDES_AR = { books: "الكتب السنوية", graduation: "التخرج", look: "قراءة أسهل", captions: "نصوص الذكاء الاصطناعي", plan: "باقتكم وهذا الجهاز", website: "على الموقع" };

for (const language of ["en", "ar"] as const) {
  test(`Help has the new guides (${language})`, async ({}, info) => {
    const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
    writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language, setupDone: true, tourDone: true, wizard: true }));
    const app = await _electron.launch({
      executablePath: require("electron") as unknown as string,
      args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    });
    const errors: string[] = [];
    const win = await app.firstWindow();
    win.on("pageerror", (e) => errors.push(e.message));
    await expect(win.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr", { timeout: 20_000 });
    await win.locator(`button.nav[data-go="help"]`).click();
    const titles = language === "en" ? GUIDES : GUIDES_AR;
    for (const [id, title] of Object.entries(titles)) {
      await win.locator(`.tree [data-id="${id}"]`).click();
      await expect(win.locator("#hp-body h1")).toContainText(title);
      const text = await win.locator("#hp-body").innerText();
      expect(text.length).toBeGreaterThan(150);
      expect(text).not.toMatch(language === "en" ? /\bchild(ren)?\b/i : /أطفال|طفل/);
      if (language === "ar") expect(text).toMatch(/[؀-ۿ]{3}/);
      if (["graduation", "website", "plan"].includes(id)) {
        const shot = await win.screenshot();
        await info.attach(`help-${id}-${language}`, { body: shot, contentType: "image/png" });
        if (process.env.HELP_SHOTS) writeFileSync(`${process.env.HELP_SHOTS}/mac-help-${id}-${language}.png`, shot);
      }
    }
    // What's new lists the new versions.
    await win.locator(`.tree [data-id="new"]`).click();
    await expect(win.locator("#hp-body")).toContainText("0.15.0");
    expect(errors).toEqual([]);
    await app.close();
  });
}
