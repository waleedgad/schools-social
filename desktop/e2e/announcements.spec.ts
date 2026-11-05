import { _electron, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Announcements (release 0.6): every template of the pack, in every size,
// with the longest texts the boxes allow in Arabic and English. The texts
// must fit between the top and the school's name (smaller if needed), the
// picture must not be blank, and a school's own design must be drawn under
// the text. The same drawing code runs on the website.
const root = path.join(__dirname, "..");

test("every announcement template fits long Arabic and English texts", async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ language: "ar", setupDone: true, tourDone: true, wizard: true, faces: false, schoolName: "مدرسة النور الدولية" }));
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  await win.waitForFunction(() => typeof (window as unknown as { drawAnnouncement?: unknown }).drawAnnouncement === "function");
  const results = (await win.evaluate(async () => {
    const w = window as unknown as {
      drawAnnouncement: (c: HTMLCanvasElement, tpl: string, size: string, t: Record<string, string>, d: { path: string; url: string }[], i: Map<string, HTMLImageElement>) => Promise<{ fits: boolean; scale: number }>;
    };
    await document.fonts.ready;
    const long = {
      // 120 letters each: the most the boxes allow.
      ar: "حفل تخريج الدفعة الثانية عشرة من طلاب وطالبات المدرسة بحضور أولياء الأمور والمعلمين والإدارة في القاعة الكبرى بالمدرسة",
      en: "Graduation ceremony of the twelfth class of students, with parents, teachers and the school leadership in the main hall",
      details: "الخميس 18 يونيو 2026 · الساعة السادسة مساءً · القاعة الكبرى · الحضور بالدعوة فقط · يرجى الحضور قبل الموعد بنصف ساعة",
      school: "مدرسة النور الدولية",
      accent: "#2f6fdf",
      ink: "#ffffff",
    };
    // A school's own design: a plain red picture.
    const d = document.createElement("canvas");
    d.width = d.height = 400;
    const dc = d.getContext("2d")!;
    dc.fillStyle = "#ff0000";
    dc.fillRect(0, 0, 400, 400);
    const url = d.toDataURL("image/png");
    const img = new Image();
    img.src = url;
    await img.decode();
    const designs = [{ path: "school/announce/red.png", url }];
    const images = new Map([[url, img]]);
    const out: { tpl: string; size: string; fits: boolean; scale: number; colours: number; corner: number[] }[] = [];
    for (const tpl of ["clean", "bold", "split", "notice", "event", "holiday", `design:${designs[0].path}`])
      for (const size of ["post", "square", "story"]) {
        const c = document.createElement("canvas");
        const r = await w.drawAnnouncement(c, tpl, size, long, designs, images);
        const px = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        const seen = new Set<number>();
        for (let i = 0; i < px.length; i += 4 * 97) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
        out.push({ tpl, size, ...r, colours: seen.size, corner: [...px.slice(0, 3)] });
      }
    // Short texts are not shrunk.
    const c = document.createElement("canvas");
    const short = await w.drawAnnouncement(c, "clean", "post", { ...long, ar: "يوم رياضي", en: "Sports day", details: "الخميس" }, [], new Map());
    out.push({ tpl: "short", size: "post", ...short, colours: 0, corner: [] });
    return out;
  })) as { tpl: string; size: string; fits: boolean; scale: number; colours: number; corner: number[] }[];

  for (const r of results.filter((x) => x.tpl !== "short")) {
    expect(r.fits, `${r.tpl} ${r.size} (text at ${Math.round(r.scale * 100)}%)`).toBe(true);
    expect(r.colours, `${r.tpl} ${r.size} is not blank`).toBeGreaterThan(20);
  }
  // The school's design is under the text (its red shows in the corner).
  for (const r of results.filter((x) => x.tpl.startsWith("design:"))) expect(r.corner, r.size).toEqual([255, 0, 0]);
  const short = results.find((x) => x.tpl === "short")!;
  expect(short).toMatchObject({ fits: true, scale: 1 });
  await app.close();
});
