import { _electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Post pictures made on the Mac from the originals (release 0.6): each size
// (Instagram 4:5, square, story 9:16, Facebook whole photo) at full quality,
// cut around the faces, with the school's frame on top and the face of a
// student who can't appear blurred, and nothing else blurred. The finished
// picture replaces the web copy for the post. Needs the test database and the
// test website (the website job on GitHub starts both).
const root = path.join(__dirname, "..");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const web = process.env.WEB_URL ?? "http://localhost:3123";
test.skip(!url || !anon || !service || !process.env.WEB_URL, "needs the test database and website (WEB_URL)");

type Hub = { hub: { call: (f: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string }> } };

test("post pictures: sizes, faces kept in, frame on, blur only where needed", async () => {
  test.setTimeout(240_000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const email = `pics-${Date.now()}@example.com`;
  const password = "test-password-123";
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const { data: school } = await admin.from("schools").insert({ name: "Post pictures school" }).select("id").single();
  const schoolId = school!.id as string;
  await admin.from("memberships").insert({ school_id: schoolId, user_id: u.user!.id, role: "admin", full_name: "Comms Lead" });

  // A wide photo (2400x1600): grey, with a checkerboard where each face is,
  // so a blur shows. Allowed student on the right, a student who can't
  // appear in the middle-right (inside a 4:5 cut), another far left (outside it).
  const sq = (x: number, y: number) => `<rect x="${x}" y="${y}" width="240" height="320" fill="url(#c)"/>`;
  const svg = `<svg width="2400" height="1600"><defs><pattern id="c" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#000"/><rect x="20" y="20" width="20" height="20" fill="#000"/><rect x="20" width="20" height="20" fill="#fff"/><rect y="20" width="20" height="20" fill="#fff"/></pattern></defs>${sq(1920, 400)}${sq(1440, 400)}${sq(120, 400)}</svg>`;
  const base = mkdtempSync(path.join(tmpdir(), "hub-pics-"));
  const ev = path.join(base, "Photos", "2025-2026", "Term 1", "2025-10-12 Sports day");
  mkdirSync(ev, { recursive: true });
  const file = path.join(ev, "IMG_5000.jpg");
  writeFileSync(file, await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 128, g: 128, b: 128 } } }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 95 }).toBuffer());
  // The school's frame: a red border, see-through in the middle.
  const frame = await sharp({ create: { width: 1000, height: 1000, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .composite([{ input: await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 50, top: 50, blend: "dest-out" }])
    .png()
    .toBuffer();
  const up = await admin.storage.from("photos").upload(`${schoolId}/frames/red.png`, frame, { contentType: "image/png" });
  expect(up.error).toBeNull();
  const frameUrl = (await admin.storage.from("photos").createSignedUrl(`${schoolId}/frames/red.png`, 3600)).data!.signedUrl;

  const userData = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({ language: "en", setupDone: true, tourDone: true, wizard: true, library: path.join(base, "Photos"), faces: false, sendMode: "picked", server: web, supabaseUrl: url, supabaseAnonKey: anon }),
  );
  const app = await _electron.launch({
    executablePath: require("electron") as unknown as string,
    args: [root, `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, HUB_TEST: "1" },
  });
  const win = await app.firstWindow();
  const call = async <T = unknown>(f: string, ...a: unknown[]) => {
    const r = await win.evaluate(([f, a]) => (window as unknown as Hub).hub.call(f as string, ...(a as unknown[])), [f, a] as const);
    expect(r.ok, `${f}: ${JSON.stringify(r)}`).toBe(true);
    return r.value as T;
  };
  await call("signIn", email, password);
  await win.locator('button.nav[data-go="library"]').click();
  await expect.poll(() => win.evaluate("lib.list.length"), { timeout: 60_000 }).toBe(1);
  await call("addStudent", { id: "P1", name_en: "Omar Hassan", name_ar: "عمر حسن", class_name: "G4A" });
  await call("addStudent", { id: "P2", name_en: "Nour Adel", name_ar: "نور عادل", class_name: "G4A" });
  await call("addStudent", { id: "P3", name_en: "Hana Ali", name_ar: "هنا علي", class_name: "G4A" });
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(userData, "library.db"));
  db.exec("pragma busy_timeout = 5000");
  db.prepare("update students set can_post = 0 where id in ('P2', 'P3')").run();
  const photoId = (db.prepare("select id from photos").get() as { id: number }).id;
  const face = db.prepare("insert into faces (photo_id, x, y, w, h, score, status, student_id) values (?, ?, 0.25, 0.1, 0.2, 0.99, 'confirmed', ?)");
  face.run(photoId, 1920 / 2400, "P1");
  // Nour isn't named for sure: the app thinks it's probably her (B-88: a
  // likely match is blurred like a named face).
  db.prepare("insert into faces (photo_id, x, y, w, h, score, status, suggest_id, suggest_score) values (?, ?, 0.25, 0.1, 0.2, 0.99, 'suggested', 'P2', 0.6)").run(photoId, 1440 / 2400);
  face.run(photoId, 120 / 2400, "P3");
  db.close();
  // The photo goes to the website for the post.
  await call("sendNow", file);
  const remote = await expect
    .poll(async () => (await admin.from("photos").select("id").eq("school_id", schoolId)).data?.[0]?.id, { timeout: 60_000 })
    .toBeTruthy()
    .then(async () => (await admin.from("photos").select("id").eq("school_id", schoolId)).data![0].id as string);

  const edited = async () => {
    const { data } = await admin.from("photos").select("edited_path, edit_settings, blur_boxes").eq("id", remote).single();
    const img = (await admin.storage.from("photos").download(data!.edited_path as string)).data!;
    return { row: data!, img: Buffer.from(await img.arrayBuffer()) };
  };
  const contrast = async (img: Buffer, left: number, top: number, width: number, height: number) => (await sharp(await sharp(img).extract({ left, top, width, height }).toBuffer()).stats()).channels[0].stdev;

  // Instagram 4:5 with the frame and blur.
  const r = await call<{ done: string[]; failed: unknown[] }>("preparePost", [remote], { shape: "4:5", frameId: "red", frameUrl, blur: true });
  expect(r).toEqual({ done: [remote], failed: [] });
  let { row, img } = await edited();
  expect(row.edit_settings).toMatchObject({ kind: "mac", crop: "4:5", frame: "red", blur: true });
  writeFileSync(test.info().outputPath("instagram.jpg"), img);
  const meta = await sharp(img).metadata();
  expect([meta.width, meta.height]).toEqual([1440, 1800]);
  // The frame is on top (red corner); the middle isn't red.
  const px = async (x: number, y: number) => [...(await sharp(img).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())];
  const [cr, cg, cb] = await px(5, 5);
  expect(cr).toBeGreaterThan(200);
  expect(cg + cb).toBeLessThan(80);
  // The cut keeps the allowed face (Omar, right) whole: 1280x1600 from x=1120,
  // scaled by 1.125, so his checkerboard is at about x 900-1170, y 450-810.
  // One blurred box, for Nour (inside the cut); none for Hana (outside).
  expect(row.blur_boxes).toHaveLength(1);
  const b = (row.blur_boxes as { x: number; y: number; w: number; h: number }[])[0];
  const bx = Math.round(b.x * 1440), by = Math.round(b.y * 1800), bw = Math.round(b.w * 1440), bh = Math.round(b.h * 1800);
  expect(await contrast(img, bx + Math.round(bw * 0.3), by + Math.round(bh * 0.3), Math.round(bw * 0.4), Math.round(bh * 0.4))).toBeLessThan(25);
  // Omar's checkerboard (allowed) is still sharp.
  expect(await contrast(img, 950, 500, 150, 200)).toBeGreaterThan(60);
  // The left edge of the picture (where Hana's blur used to leak in) is untouched grey.
  expect(await contrast(img, 100, 600, 120, 400)).toBeLessThan(8);
  const [lr, lg, lb] = await px(100, 800);
  expect(Math.abs(lr - 128) + Math.abs(lg - 128) + Math.abs(lb - 128)).toBeLessThan(30);

  // Square, story and Facebook (whole photo, up to 2048 wide).
  for (const [shape, size] of [["1:1", [1440, 1440]], ["9:16", [1080, 1920]], ["fb", [2048, 1365]]] as const) {
    expect(await call("preparePost", [remote], { shape, frameId: null, frameUrl: null, blur: false })).toEqual({ done: [remote], failed: [] });
    ({ row, img } = await edited());
    const m = await sharp(img).metadata();
    expect([m.width, m.height], shape).toEqual(size);
    expect(row.edit_settings).toMatchObject({ crop: shape, blur: false });
  }
  // Only the newest picture is kept on the website.
  const files = ((await admin.storage.from("photos").list(schoolId)).data ?? []).map((f) => f.name).filter((n) => n.startsWith(`${remote}_e`));
  expect(files).toHaveLength(2); // the picture and its small copy
  // A photo that isn't on this Mac is reported, not dropped silently.
  const missing = "00000000-0000-0000-0000-000000000000";
  expect(await call("preparePost", [missing], { shape: "4:5", frameId: null, frameUrl: null, blur: false })).toEqual({ done: [], failed: [{ id: missing, why: "not-on-mac" }] });
  await app.close();
});
