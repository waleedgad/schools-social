import { _electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// The Mac app and the test database together (the website job runs it).
//   B-92  "blur faces of people who can't appear" never reached the website:
//         the web copy can't be overwritten in storage, so the photo stayed
//         blocked instead of blurred
//   B-89  a photo changed in another app after it went to the website was
//         sent again as a second photo; now its website copy is replaced
//         (Waleed, 11 Nov 2026)
const root = path.join(__dirname, "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
test.skip(!url || !anon || !service, "needs the test database (source e2e/test-db.env)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };

const picture = (shade: number, bar: number) =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: shade, g: 120, b: 200 - shade / 2 } } })
    .composite([{ input: Buffer.from(`<svg width="1200" height="800"><rect x="${bar}" y="100" width="120" height="600" fill="white"/></svg>`), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();

test("web copies: blurred for students who can't appear, replaced when the photo is edited", async () => {
  test.setTimeout(240_000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const email = `replace-${Date.now()}@example.com`;
  const password = "test-password-123";
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const { data: school } = await admin.from("schools").insert({ name: "Replace school" }).select("id").single();
  const schoolId = school!.id as string;
  await admin.from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role: "admin", full_name: "Mac Tester" });
  const web = async () => (await admin.from("photos").select("id, storage_path, source_key, blur_boxes, contains_opted_out, width").eq("school_id", schoolId)).data ?? [];
  const files = async () => ((await admin.storage.from("photos").list(schoolId)).data ?? []).map((f) => f.name).sort();

  const base = mkdtempSync(path.join(tmpdir(), "hub-replace-"));
  const ev = path.join(base, "Photos", "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  const file = path.join(ev, "IMG_7000.jpg");
  writeFileSync(file, await picture(40, 200));
  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: path.join(base, "Photos"), faces: false, sendMode: "picked", server: "http://127.0.0.1:9", supabaseUrl: url, supabaseAnonKey: anon }),
  );
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  try {
    const win = await app.firstWindow();
    const call = async <T = unknown>(f: string, ...a: unknown[]) => {
      const r = await win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
      expect(r.ok, `${f}: ${JSON.stringify(r)}`).toBe(true);
      return r.value as T;
    };
    await call("signIn", email, password);
    await win.locator('button.nav[data-go="library"]').click();
    await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(1);
    await call("sendNow", file);
    await expect.poll(async () => (await web()).length, { timeout: 60_000 }).toBe(1);
    const first = (await web())[0];

    // ---------- B-92: a student who can't appear is blurred, not blocked ----------
    await call("addStudent", { id: "NO1", name_en: "Nour Adel", name_ar: "نور عادل", class_name: "G4A" });
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(userData, "library.db"));
    db.exec("pragma busy_timeout = 5000");
    const photoId = (db.prepare("select id from photos").get() as { id: number }).id;
    await expect.poll(() => (db.prepare("select remote_id from photos where id = ?").get(photoId) as { remote_id: string | null }).remote_id, { timeout: 30_000 }).toBe(first.id);
    db.prepare("insert into faces (photo_id, x, y, w, h, score, status, student_id) values (?, 0.15, 0.2, 0.12, 0.2, 0.99, 'confirmed', 'NO1')").run(photoId);
    db.close();
    await call("setCanPost", "NO1", false);
    await expect
      .poll(async () => {
        const r = (await web())[0];
        return { boxes: (r.blur_boxes as unknown[]).length, blocked: r.contains_opted_out };
      }, { timeout: 60_000, message: "B-92: the web copy is blurred and usable" })
      .toEqual({ boxes: 1, blocked: false });
    const blurred = (await web())[0];
    expect(blurred.storage_path).not.toBe(first.storage_path);
    expect(await files(), "the old pictures are gone").not.toContain(path.basename(first.storage_path as string));

    // Nour may appear again: the plain copy comes back.
    await call("setCanPost", "NO1", true);
    await expect.poll(async () => ((await web())[0].blur_boxes as unknown[]).length, { timeout: 60_000 }).toBe(0);

    // ---------- B-89: the photo is retouched in another app ----------
    const before = (await web())[0];
    writeFileSync(file, await picture(160, 700));
    await expect
      .poll(async () => {
        const rows = await web();
        return rows.length === 1 && rows[0].source_key !== before.source_key ? "replaced" : `${rows.length} photos`;
      }, { timeout: 90_000, message: "B-89: one photo on the website, now the new version" })
      .toBe("replaced");
    const after = (await web())[0];
    expect(after.id).toBe(first.id);
    expect(after.storage_path).not.toBe(before.storage_path);
    const img = (await admin.storage.from("photos").download(after.storage_path as string)).data!;
    const { dominant } = await sharp(Buffer.from(await img.arrayBuffer())).stats();
    expect(dominant.r, "the website shows the retouched picture").toBeGreaterThan(110);
    expect((await files()).filter((f) => !f.endsWith("_t.jpg"))).toEqual([path.basename(after.storage_path as string)]);
  } finally {
    await app.close();
  }
});
