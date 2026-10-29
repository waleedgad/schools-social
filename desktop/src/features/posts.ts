import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { net } from "electron";
import sharp from "sharp";
import { YEARBOOK_ALBUMS } from "../core/books";
import { exclusive } from "../core/lock";
import { source } from "../core/media";
import { hijriOf, OCCASIONS, type Filter } from "./library";
import { marks, q, type Api, type Ctx } from "./ctx";

// Posts made on the Mac: the photos chosen from any filter (one post, one
// per class or one per day), the crop to each platform's shape done from the
// original with the faces kept in, the school's frame on top, can't-appear
// faces blurred or the photo left out, collages, and "who's in this post".
// Face names never leave the Mac: the website only gets finished pictures.

export const SHAPES: Record<string, number | null> = { "4:5": 4 / 5, "1:1": 1, "9:16": 9 / 16, fb: null, original: null };
const LONG = { "4:5": [1440, 1800], "1:1": [1440, 1440], "9:16": [1080, 1920] } as Record<string, [number, number]>;

type Box = { x: number; y: number; w: number; h: number };

// Where to cut a photo of width W and height H to the ratio r so that every
// face stays in (or as many as fit, centred on the biggest group).
export function smartCrop(W: number, H: number, r: number, faces: Box[]) {
  if (W / H > r) {
    const w = Math.round(H * r);
    if (!faces.length) return { left: Math.round((W - w) / 2), top: 0, width: w, height: H };
    const lo = Math.min(...faces.map((f) => f.x)) * W;
    const hi = Math.max(...faces.map((f) => f.x + f.w)) * W;
    const mid = hi - lo <= w ? (lo + hi) / 2 : faces.reduce((s, f) => s + (f.x + f.w / 2) * f.w, 0) / faces.reduce((s, f) => s + f.w, 0) * W;
    return { left: Math.round(Math.min(W - w, Math.max(0, mid - w / 2))), top: 0, width: w, height: H };
  }
  const h = Math.round(W / r);
  if (!faces.length) return { left: 0, top: Math.round(Math.max(0, (H - h) * 0.35)), width: W, height: h };
  // Faces sit a little above the middle; keep room for bodies under them.
  const lo = Math.min(...faces.map((f) => f.y)) * H;
  const hi = Math.max(...faces.map((f) => f.y + f.h)) * H;
  const top = hi - lo <= h ? lo - (h - (hi - lo)) * 0.3 : lo - h * 0.1;
  return { left: 0, top: Math.round(Math.min(H - h, Math.max(0, top))), width: W, height: h };
}

// Where each frame is kept on this Mac (downloaded once).
async function frameFile(ctx: Ctx, url: string | null, id: string | null) {
  if (!url || !id) return null;
  const file = ctx.data(`cache/frames/${id}.png`);
  if (existsSync(file)) return file;
  const res = await net.fetch(url);
  if (!res.ok) return null;
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(ctx.data("cache/frames"), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

export function postsApi(ctx: Ctx): Api {
  const { one, all } = q(ctx);

  const facesOf = (id: number) => all<Box & { student_id: string | null; can_post: number | null }>(
    "select f.x, f.y, f.w, f.h, f.student_id, s.can_post from faces f left join students s on s.id = f.student_id where f.photo_id = ? and f.status <> 'notface' and f.w > 0.015",
    id,
  );
  const localOf = (remote: string[]) =>
    remote.length ? all<{ id: number; path: string; remote_id: string; width: number; height: number; missing: number; posts: number }>(`select id, path, remote_id, width, height, missing, posts from photos where remote_id in (${marks(remote.length)})`, ...remote) : [];

  // One finished picture from the original: cropped, framed and blurred.
  async function render(id: number, o: { shape: string; frame: string | null; blur: boolean; position?: number | null }) {
    const p = one<{ path: string }>("select path from photos where id = ?", id);
    if (!p || !existsSync(p.path)) throw new Error("original-missing");
    return exclusive(async () => {
      const base = await sharp(await source(p.path), { failOn: "none" }).rotate().toBuffer({ resolveWithObject: true });
      const W = base.info.width, H = base.info.height;
      const faces = facesOf(id);
      const ratio = SHAPES[o.shape] ?? null;
      let box = { left: 0, top: 0, width: W, height: H };
      if (ratio) {
        box = smartCrop(W, H, ratio, faces.filter((f) => f.can_post !== 0));
        // A hand-moved crop (0..1 along the long side) wins over the faces.
        if (o.position != null) {
          if (box.width < W) box.left = Math.round((W - box.width) * o.position);
          else box.top = Math.round((H - box.height) * o.position);
        }
      }
      let img = sharp(base.data).extract(box);
      const parts: sharp.OverlayOptions[] = [];
      const [tw, th] = ratio ? LONG[o.shape] : [2048, 2048];
      const out = await img.resize(tw, th, { fit: ratio ? "cover" : "inside", withoutEnlargement: !ratio }).toBuffer({ resolveWithObject: true });
      const ow = out.info.width, oh = out.info.height;
      const blurred: Box[] = [];
      if (o.blur) {
        for (const f of faces.filter((x) => x.can_post === 0)) {
          // The face box in the cropped picture.
          const fx = ((f.x - f.w * 0.2) * W - box.left) / box.width, fy = ((f.y - f.h * 0.25) * H - box.top) / box.height;
          const fw = (f.w * 1.4 * W) / box.width, fh = (f.h * 1.5 * H) / box.height;
          const left = Math.max(0, Math.floor(fx * ow)), top = Math.max(0, Math.floor(fy * oh));
          const width = Math.min(ow - left, Math.ceil(fw * ow)), height = Math.min(oh - top, Math.ceil(fh * oh));
          if (width < 4 || height < 4) continue;
          const input = await sharp(out.data).extract({ left, top, width, height }).resize(Math.max(2, Math.round(width / 24)), Math.max(2, Math.round(height / 24))).resize(width, height, { kernel: "cubic" }).blur(Math.max(2, width / 14)).toBuffer();
          parts.push({ input, left, top });
          blurred.push({ x: left / ow, y: top / oh, w: width / ow, h: height / oh });
        }
      }
      if (o.frame && existsSync(o.frame)) parts.push({ input: await sharp(await readFile(o.frame)).resize(ow, oh, { fit: "fill" }).png().toBuffer(), left: 0, top: 0 });
      img = sharp(out.data);
      if (parts.length) img = img.composite(parts);
      const full = await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      const thumb = await sharp(full.data).resize(480, 480, { fit: "inside" }).jpeg({ quality: 75 }).toBuffer();
      return { full: full.data, thumb, width: full.info.width, height: full.info.height, blurred };
    });
  }

  async function upload(name: string, full: Buffer, thumb: Buffer) {
    const sb = ctx.client();
    const s = ctx.settings().get();
    if (!sb || !s.schoolId) throw new Error("not-signed-in");
    const bucket = sb.storage.from("photos");
    const path = `${s.schoolId}/${name}.jpg`;
    const opts = { contentType: "image/jpeg", upsert: true };
    const [a, b] = await Promise.all([bucket.upload(path, full, opts), bucket.upload(`${s.schoolId}/${name}_t.jpg`, thumb, opts)]);
    if (a.error || b.error) throw new Error((a.error ?? b.error)!.message);
    return path;
  }

  return {
    // The photos a filter gives, and which of them the app would pick.
    postCandidates: async (filter: Filter & { ids?: number[] }, count = 8) => {
      const list = (await ctx.call("photos", { ...filter, limit: 3000 })) as { id: number; class_name: string | null; taken_at: string | null; event_date: string | null; no_post: number; posts: number; flag: number }[];
      const usable = list.filter((p) => p.flag >= 0);
      const best = (await ctx.call("best", usable.map((p) => p.id), count)) as number[];
      const classes = new Map<string, number>();
      const days = new Map<string, number>();
      for (const p of usable) {
        if (p.class_name) classes.set(p.class_name, (classes.get(p.class_name) ?? 0) + 1);
        const d = (p.taken_at ?? p.event_date ?? "").slice(0, 10);
        if (d) days.set(d, (days.get(d) ?? 0) + 1);
      }
      return {
        total: usable.length,
        ids: usable.map((p) => p.id),
        best,
        noPost: usable.filter((p) => p.no_post > 0).length,
        posted: usable.filter((p) => p.posts > 0).length,
        classes: [...classes.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
        days: [...days.entries()].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day)),
      };
    },

    // Makes the posts: one, one per class or one per day. Each picks its
    // best photos; the AI writes the captions when asked, with the notes.
    makePosts: async (filter: Filter & { ids?: number[] }, o: { mode: "one" | "class" | "day" | "single"; count: number; notes?: string; write?: boolean; day?: string | null; category?: string | null }) => {
      const list = (await ctx.call("photos", { ...filter, limit: 3000 })) as { id: number; class_name: string | null; taken_at: string | null; event_date: string | null; flag: number }[];
      const usable = list.filter((p) => p.flag >= 0);
      const groups = new Map<string, number[]>();
      for (const p of usable) {
        const k = o.mode === "class" ? p.class_name ?? "" : o.mode === "day" ? (p.taken_at ?? p.event_date ?? "").slice(0, 10) : "";
        groups.set(k, [...(groups.get(k) ?? []), p.id]);
      }
      const made: { id: string; group: string; photos: number }[] = [];
      for (const [group, ids] of groups) {
        if (!ids.length) continue;
        const chosen = o.mode === "single" ? ids.slice(0, 80) : ((await ctx.call("best", ids, o.count)) as number[]);
        if (!chosen.length) continue;
        const id = (await ctx.call("newPost", chosen)) as string;
        const notes = [o.notes, o.mode === "class" && group ? `Class ${group}` : "", o.mode === "day" && group ? `Day ${group}` : ""].filter(Boolean).join(". ");
        if (o.category) await ctx.appApi("intent", { id, intent: "save", values: { category_id: o.category } }).catch(() => null);
        if (o.day) await ctx.appApi("move", { id, day: o.day }).catch(() => null);
        if (o.write) await ctx.appApi("generate", { id, options: { count: 3, prompt: notes || null } }).catch(() => null);
        else if (notes) await ctx.appApi("comment", { id, body: notes }).catch(() => null);
        made.push({ id, group, photos: chosen.length });
      }
      return made;
    },

    // Who's in this post: names (only shown on the Mac), how often each has
    // been posted, and anyone who can't appear.
    postPeople: (remote: string[]) => {
      const local = localOf(remote);
      if (!local.length) return { people: [], cantAppear: [], unnamed: 0, notOnMac: remote.length };
      const ids = local.map((p) => p.id);
      const rows = all<{ photo_id: number; student_id: string | null; status: string; name_en: string | null; name_ar: string | null; class_name: string | null; can_post: number | null; kind: string | null }>(
        `select f.photo_id, f.student_id, f.status, s.name_en, s.name_ar, s.class_name, s.can_post, s.kind from faces f left join students s on s.id = f.student_id where f.photo_id in (${marks(ids.length)}) and f.status <> 'notface' and f.w > 0.015`,
        ...ids,
      );
      const posted = new Map(
        all<{ student_id: string; n: number }>(
          "select f.student_id, count(distinct p.id) n from faces f join photos p on p.id = f.photo_id where p.posts > 0 and f.status in ('confirmed', 'manual') and f.student_id is not null group by f.student_id",
        ).map((r) => [r.student_id, r.n]),
      );
      const people = new Map<string, { id: string; name_en: string | null; name_ar: string | null; class_name: string | null; kind: string | null; photos: number; posted: number; can_post: number }>();
      let unnamed = 0;
      for (const r of rows) {
        if (!r.student_id || !["confirmed", "manual"].includes(r.status)) {
          unnamed++;
          continue;
        }
        const p = people.get(r.student_id) ?? { id: r.student_id, name_en: r.name_en, name_ar: r.name_ar, class_name: r.class_name, kind: r.kind, photos: 0, posted: posted.get(r.student_id) ?? 0, can_post: r.can_post ?? 1 };
        p.photos++;
        people.set(r.student_id, p);
      }
      const list = [...people.values()].sort((a, b) => (a.class_name ?? "").localeCompare(b.class_name ?? "", undefined, { numeric: true }) || (a.name_en ?? "").localeCompare(b.name_en ?? ""));
      const byPhoto = new Map<string, number>();
      for (const r of rows) if (r.can_post === 0 && ["confirmed", "manual"].includes(r.status)) {
        const remoteId = local.find((l) => l.id === r.photo_id)?.remote_id;
        if (remoteId) byPhoto.set(remoteId, (byPhoto.get(remoteId) ?? 0) + 1);
      }
      return {
        people: list.filter((p) => p.can_post !== 0),
        cantAppear: list.filter((p) => p.can_post === 0),
        cantAppearPhotos: [...byPhoto.entries()].map(([id, n]) => ({ id, n })),
        unnamed,
        notOnMac: remote.length - local.length,
      };
    },

    // Crop, frame and blur the post's photos from the originals and put the
    // finished pictures on the website in place of the plain web copies.
    preparePost: async (remote: string[], o: { shape: string; frameId: string | null; frameUrl: string | null; blur: boolean; positions?: Record<string, number> }) => {
      const frame = await frameFile(ctx, o.frameUrl, o.frameId).catch(() => null);
      const local = localOf(remote);
      const done: string[] = [];
      const failed: { id: string; why: string }[] = [];
      for (const rid of remote) {
        const l = local.find((x) => x.remote_id === rid);
        if (!l) {
          failed.push({ id: rid, why: "not-on-mac" });
          continue;
        }
        try {
          const r = await render(l.id, { shape: o.shape, frame, blur: o.blur, position: o.positions?.[rid] ?? null });
          const path = await upload(`${rid}_e${Date.now()}`, r.full, r.thumb);
          await ctx.appApi("editPhoto", { photo: rid, path, settings: { kind: "mac", crop: o.shape, frame: o.frameId, blur: o.blur, position: o.positions?.[rid] ?? null }, blur: r.blurred });
          done.push(rid);
        } catch (e) {
          failed.push({ id: rid, why: (e as Error).message });
        }
      }
      return { done, failed };
    },

    // A local preview of how one photo will look (crop, frame, blur).
    previewCrop: async (remote: string, o: { shape: string; frameId: string | null; frameUrl: string | null; blur: boolean; position?: number | null }) => {
      const l = localOf([remote])[0];
      if (!l) return null;
      const frame = await frameFile(ctx, o.frameUrl, o.frameId).catch(() => null);
      const r = await render(l.id, { shape: o.shape, frame, blur: o.blur, position: o.position ?? null });
      return `data:image/jpeg;base64,${r.thumb.toString("base64")}`;
    },

    // Two to six photos in one picture, made from the originals.
    makeCollage: async (ids: number[], o: { layout: "2" | "3" | "4" | "6"; shape: "4:5" | "1:1"; gap?: number; postId?: string | null; remote?: string[] }) => {
      const local = ids.length ? ids : localOf(o.remote ?? []).map((p) => p.id);
      const n = Math.min(local.length, Number(o.layout));
      if (n < 2) throw new Error("need-two");
      const [W, H] = o.shape === "1:1" ? [1440, 1440] : [1440, 1800];
      const gap = o.gap ?? 12;
      const cells: { x: number; y: number; w: number; h: number }[] = [];
      const cols = n <= 3 ? (n === 2 ? 1 : 1) : 2;
      if (n === 2) cells.push({ x: 0, y: 0, w: W, h: (H - gap) / 2 }, { x: 0, y: (H + gap) / 2, w: W, h: (H - gap) / 2 });
      else if (n === 3) cells.push({ x: 0, y: 0, w: W, h: (H - gap) * 0.55 }, { x: 0, y: (H - gap) * 0.55 + gap, w: (W - gap) / 2, h: (H - gap) * 0.45 }, { x: (W + gap) / 2, y: (H - gap) * 0.55 + gap, w: (W - gap) / 2, h: (H - gap) * 0.45 });
      else {
        const rows = Math.ceil(n / cols);
        for (let i = 0; i < n; i++) cells.push({ x: (i % cols) * ((W + gap) / cols), y: Math.floor(i / cols) * ((H + gap) / rows), w: (W - gap * (cols - 1)) / cols, h: (H - gap * (rows - 1)) / rows });
      }
      const parts: sharp.OverlayOptions[] = [];
      for (let i = 0; i < n; i++) {
        const c = cells[i];
        const w = Math.round(c.w), h = Math.round(c.h);
        const p = one<{ path: string }>("select path from photos where id = ?", local[i]);
        if (!p || !existsSync(p.path)) continue;
        const input = await exclusive(async () => {
          const base = await sharp(await source(p.path), { failOn: "none" }).rotate().toBuffer({ resolveWithObject: true });
          const box = smartCrop(base.info.width, base.info.height, w / h, facesOf(local[i]).filter((f) => f.can_post !== 0));
          return sharp(base.data).extract(box).resize(w, h, { fit: "cover" }).toBuffer();
        });
        parts.push({ input, left: Math.round(c.x), top: Math.round(c.y) });
      }
      const full = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite(parts).jpeg({ quality: 90 }).toBuffer();
      const thumb = await sharp(full).resize(480, 480, { fit: "inside" }).jpeg({ quality: 75 }).toBuffer();
      const sb = ctx.client();
      const s = ctx.settings().get();
      if (!sb || !s.schoolId) return { preview: `data:image/jpeg;base64,${thumb.toString("base64")}` };
      const { randomUUID } = await import("node:crypto");
      const id = randomUUID();
      const path = await upload(id, full, thumb);
      const { error } = await sb.from("photos").insert({ id, school_id: s.schoolId, uploaded_by: s.userId, source: "design", storage_path: path, width: W, height: H, size_bytes: full.byteLength, original_name: "collage.jpg" });
      if (error) throw new Error(error.message);
      if (o.postId) {
        const order = [id, ...(o.remote ?? [])];
        await ctx.appApi("postPhotos", { id: o.postId, order });
        await ctx.appApi("setPost", { id: o.postId, values: { cover_collage: true } }).catch(() => null);
      }
      return { id, preview: `data:image/jpeg;base64,${thumb.toString("base64")}` };
    },

    // The post's photos that are on this Mac, as library ids (to open them
    // in the viewer or pick more from the same event).
    // A post's photos for the yearbooks: they go into the "Yearbook picks"
    // album, which the yearbook drafts use first.
    yearbookPick: (remote: string[]) => {
      const ids = localOf(remote).map((p) => p.id);
      if (!ids.length) return { added: 0 };
      let album = one<{ id: number }>(`select id from albums where name in (${marks(YEARBOOK_ALBUMS.length)}) and rule is null order by id limit 1`, ...YEARBOOK_ALBUMS);
      if (!album) album = { id: Number(ctx.db().prepare("insert into albums (name, added_at) values (?, ?)").run(ctx.settings().get().language === "en" ? YEARBOOK_ALBUMS[0] : YEARBOOK_ALBUMS[1], Date.now()).lastInsertRowid) };
      const add = ctx.db().prepare("insert or ignore into album_photos (album_id, photo_id) values (?, ?)");
      for (const id of ids) add.run(album.id, id);
      ctx.push("photos");
      return { added: ids.length };
    },
    postLocal: (remote: string[]) => localOf(remote).map((p) => ({ id: p.id, remote_id: p.remote_id, missing: p.missing, posts: p.posts, event_key: one<{ event_key: string | null }>("select event_key from photos where id = ?", p.id)?.event_key ?? null })),

    // Library photos to add to a post: the same event first, best first.
    morePhotos: (remote: string[], limit = 60) => {
      const local = localOf(remote);
      const ev = local.length ? one<{ event_key: string | null }>("select event_key from photos where id = ?", local[0].id)?.event_key : null;
      const used = new Set(local.map((p) => p.id));
      const rows = all<{ id: number; remote_id: string | null; quality: number; posts: number }>(
        ev ? "select id, remote_id, quality, posts from photos where event_key = ? and flag >= 0 and missing = 0 and coalesce(hidden, 0) = 0 order by flag desc, rating desc, quality desc limit ?" : "select id, remote_id, quality, posts from photos where flag > 0 and missing = 0 order by taken_at desc limit ?",
        ...(ev ? [ev, limit + used.size] : [limit + used.size]),
      );
      return rows.filter((r) => !used.has(r.id)).slice(0, limit);
    },

    // Sends library photos (web copies) and returns their website ids.
    sendPhotos: async (ids: number[]) => {
      const out: string[] = [];
      for (const id of ids.slice(0, 40)) {
        const p = one<{ path: string; remote_id: string | null }>("select path, remote_id from photos where id = ?", id);
        if (!p) continue;
        if (!p.remote_id) await ctx.call("sendNow", p.path).catch(() => null);
        const after = one<{ remote_id: string | null }>("select remote_id from photos where id = ?", id);
        if (after?.remote_id) out.push(after.remote_id);
      }
      ctx.db().prepare(`update photos set posts = posts + 1 where id in (${marks(ids.length)})`).run(...ids);
      ctx.push("photos");
      return out;
    },
    // Announcements: the school's own uploaded designs (kept on the website
    // so the phone and the Mac share them), a new design from a file, and
    // the finished picture turned into a draft post.
    announceDesigns: async () => {
      const sb = ctx.client();
      const s = ctx.settings().get();
      if (!sb || !s.schoolId) return [];
      const { data } = await sb.storage.from("photos").list(`${s.schoolId}/announce`, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      const paths = (data ?? []).filter((f) => f.name && !f.name.startsWith(".")).map((f) => `${s.schoolId}/announce/${f.name}`);
      if (!paths.length) return [];
      const { data: signed } = await sb.storage.from("photos").createSignedUrls(paths, 3600);
      return (signed ?? []).filter((x) => x.signedUrl).map((x) => ({ path: x.path, url: x.signedUrl }));
    },
    addDesign: async () => {
      const { dialog } = await import("electron");
      const win = ctx.win();
      const r = win ? await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }] }) : null;
      const file = r?.filePaths?.[0];
      if (!file) return null;
      const sb = ctx.client();
      const s = ctx.settings().get();
      if (!sb || !s.schoolId) throw new Error("not-signed-in");
      const { randomUUID } = await import("node:crypto");
      const ext = file.toLowerCase().endsWith(".png") ? "png" : "jpg";
      const { error } = await sb.storage.from("photos").upload(`${s.schoolId}/announce/${randomUUID()}.${ext}`, await readFile(file), { contentType: ext === "png" ? "image/png" : "image/jpeg" });
      if (error) throw new Error(error.message);
      return true;
    },
    saveAnnouncement: async (jpeg: string, o: { ar: string; en: string; category: string | null; day: string | null }) => {
      const sb = ctx.client();
      const s = ctx.settings().get();
      if (!sb || !s.schoolId) throw new Error("not-signed-in");
      const full = Buffer.from(jpeg.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const meta = await sharp(full).metadata();
      const thumb = await sharp(full).resize(480, 480, { fit: "inside" }).jpeg({ quality: 75 }).toBuffer();
      const { randomUUID } = await import("node:crypto");
      const id = randomUUID();
      const path = await upload(id, full, thumb);
      const { error } = await sb.from("photos").insert({ id, school_id: s.schoolId, uploaded_by: s.userId, source: "design", storage_path: path, width: meta.width, height: meta.height, size_bytes: full.byteLength, original_name: "announcement.jpg" });
      if (error) throw new Error(error.message);
      const r = await ctx.appApi("createMany", { why: "announcement", posts: [{ photos: [id], caption_ar: o.ar, caption_en: o.en, category_id: o.category, day: o.day, time: "15:00" }] });
      return (r.ids as string[])[0] ?? null;
    },
    // Occasions (Ramadan, Eids, national days...) between two days, for the
    // calendar: the first day of each.
    occasionsBetween: (from: string, to: string) => {
      const out: { id: string; date: string }[] = [];
      const seen = new Set<string>();
      for (let t = Date.parse(`${from}T12:00:00`); t <= Date.parse(`${to}T12:00:00`); t += 86400_000) {
        const d = new Date(t);
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const h = hijriOf(day);
        for (const o of OCCASIONS) {
          if (o.id === "graduation") continue;
          const key = `${o.id}:${day.slice(0, 7)}`;
          if (seen.has(o.id + day.slice(0, 4)) || seen.has(key)) continue;
          if (o.test(day, h)) {
            seen.add(o.id + day.slice(0, 4));
            out.push({ id: o.id, date: day });
          }
        }
      }
      return out;
    },

    // A school's term calendar from a file: Excel, CSV or a calendar file
    // (.ics from Google or Outlook). Each row: a date (and end date) and a title.
    readCalendarFile: async () => {
      const { dialog } = await import("electron");
      const win = ctx.win();
      const r = win ? await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Calendar", extensions: ["xlsx", "csv", "ics"] }] }) : null;
      const file = r?.filePaths?.[0];
      if (!file) return null;
      const out: { title: string; event_date: string; ends_on: string | null; kind: string }[] = [];
      const toDay = (v: unknown): string | null => {
        if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
        const t = String(v ?? "").trim();
        let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
        m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
        m = t.match(/^(\d{4})(\d{2})(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        return null;
      };
      const kindOf = (title: string) =>
        /holiday|break|vacation|عطلة|إجازة|اجازة/i.test(title) ? "holiday" : /exam|test|امتحان|اختبار/i.test(title) ? "exam" : /trip|visit|رحلة|زيارة/i.test(title) ? "trip" : /sport|match|رياض|مباراة/i.test(title) ? "sport" : /meeting|اجتماع/i.test(title) ? "meeting" : "event";
      const text = file.toLowerCase().endsWith(".xlsx") ? null : await readFile(file, "utf8");
      if (text !== null && file.toLowerCase().endsWith(".ics")) {
        for (const block of text.split("BEGIN:VEVENT").slice(1)) {
          const unfold = block.replace(/\r?\n[ \t]/g, "");
          const get = (k: string) => unfold.match(new RegExp(`^${k}[^:]*:(.*)$`, "m"))?.[1]?.trim() ?? "";
          const start = toDay(get("DTSTART"));
          let end = toDay(get("DTEND"));
          // An all-day event's end is the day after.
          if (end && /VALUE=DATE/.test(unfold.match(/^DTEND[^\n]*/m)?.[0] ?? "")) end = new Date(Date.parse(`${end}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
          const title = get("SUMMARY").replace(/\\,/g, ",").slice(0, 120);
          if (start && title) out.push({ title, event_date: start, ends_on: end && end > start ? end : null, kind: kindOf(title) });
        }
        return { file: file.split(/[\\/]/).pop(), events: out };
      }
      let rows: unknown[][] = [];
      if (text !== null) rows = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, "").trim()));
      else {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(file);
        wb.worksheets[0]?.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((c) => (c && typeof c === "object" && "text" in (c as object) ? (c as { text: string }).text : c))));
      }
      for (const r of rows) {
        const days = r.map(toDay);
        const first = days.findIndex(Boolean);
        if (first < 0) continue;
        const second = days.findIndex((d, i) => d && i > first);
        const title = r.find((c, i) => i !== first && i !== second && typeof c === "string" && c.trim().length >= 2 && !toDay(c)) as string | undefined;
        if (!title) continue;
        out.push({ title: title.trim().slice(0, 120), event_date: days[first]!, ends_on: second > 0 && days[second]! > days[first]! ? days[second]! : null, kind: kindOf(title) });
      }
      return { file: file.split(/[\\/]/).pop(), events: out };
    },
  };
}
