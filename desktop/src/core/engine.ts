import { existsSync, mkdirSync } from "node:fs";
import { copyFile, readdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import exifr from "exifr";
import sharp from "sharp";
import { fromBlob, toBlob, tx, type Db } from "./db";
import { bestMatch, cosine, findFaces, SAME_PERSON } from "./faces";
import { eventFolder, isLibraryFile, isoDate, isRaw, placeFromPath, safeName, schoolYear, term } from "./library";
import { hamming, makeThumb, measure, score, source } from "./media";
import { exclusive } from "./lock";
import { fileHash } from "./photo";
import type { StudentRow } from "./students";

// The library on this computer: finds every photo under the library folder,
// keeps the index up to date as files are added, renamed or moved, makes
// thumbnails, scores quality and finds faces in the background.

export type EngineOptions = {
  db: Db;
  library: string;
  cache: string;
  models: string;
  faces: () => boolean;
  paused: () => boolean;
  onChange: (what: string) => void;
  onPhotoReady?: (id: number) => void;
  log?: (m: string) => void;
};

type Row = Record<string, unknown>;
const THUMB = 420;
const PREVIEW = 2048;
const EDIT = /^(.*?)[-_ ](edit|edited|copy|retouch|retouched|final)(?:[-_ ]?\d+)?$/i;

export class Engine {
  private watcher: FSWatcher | null = null;
  private work: number[] = [];
  private faceWork: number[] = [];
  private running = 0;
  private scanning = false;
  private timer: NodeJS.Timeout | null = null;
  status = { scanning: false, processing: 0, faceQueue: 0, found: 0 };

  constructor(private o: EngineOptions) {
    mkdirSync(path.join(o.cache, "thumbs"), { recursive: true });
    mkdirSync(path.join(o.cache, "previews"), { recursive: true });
  }

  get db() {
    return this.o.db;
  }

  thumbPath(id: number) {
    return path.join(this.o.cache, "thumbs", `${id}.jpg`);
  }
  previewPath(id: number) {
    return path.join(this.o.cache, "previews", `${id}.jpg`);
  }

  private skipped(file: string) {
    const rel = path.relative(this.o.library, file);
    if (rel.startsWith("..")) return true;
    if (rel.split(path.sep).some((p) => p.startsWith(".") || p === "Bin")) return true;
    const skips = this.db.prepare("select path from folders where skip = 1").all() as { path: string }[];
    return skips.some((s) => file === s.path || file.startsWith(s.path + path.sep));
  }

  async start() {
    this.timer = setInterval(() => this.pump(), 400);
    this.watcher = watch(this.o.library, {
      ignoreInitial: true,
      alwaysStat: true,
      depth: 10,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 },
      ignored: (p, stats) => path.basename(p).startsWith(".") || (!!stats?.isFile() && !isLibraryFile(p)),
    });
    this.watcher.on("add", (file, stats) => stats && this.seen(file, stats.size, stats.mtimeMs));
    this.watcher.on("change", (file, stats) => stats && this.seen(file, stats.size, stats.mtimeMs));
    this.watcher.on("unlink", (file) => this.gone(file));
    this.watcher.on("unlinkDir", (dir) => {
      this.db.prepare("update photos set missing = 1 where path like ? escape '\\'").run(like(dir + path.sep));
      this.o.onChange("photos");
    });
    this.watcher.on("error", (e) => this.o.log?.(`watch: ${String(e)}`));
    await this.scan();
    this.queueUnfinished();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.watcher?.close();
    this.watcher = null;
  }

  // Walks the whole library once. Files that haven't changed are skipped.
  async scan() {
    if (this.scanning) return;
    this.scanning = this.status.scanning = true;
    this.o.onChange("status");
    const known = new Map<string, { size: number; mtime: number }>();
    for (const r of this.db.prepare("select path, size, mtime from photos where path not like ':%'").all() as { path: string; size: number; mtime: number }[]) {
      known.set(r.path, r);
    }
    const present = new Set<string>();
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      // "IMG_1.jpg" before "IMG_1 copy.jpg", so the plain name is the one kept when they match.
      const stem = (n: string) => n.slice(0, n.length - path.extname(n).length);
      entries.sort((a, b) => stem(a.name).localeCompare(stem(b.name)) || a.name.localeCompare(b.name));
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.name.startsWith(".")) continue;
        if (e.isDirectory()) {
          if (!this.skipped(full + path.sep + "x")) await walk(full);
        } else if (e.isFile() && isLibraryFile(full)) {
          present.add(full);
          const k = known.get(full);
          if (k) continue;
          try {
            const s = await stat(full);
            this.seen(full, s.size, s.mtimeMs);
            this.status.found++;
          } catch {
            // vanished while scanning
          }
        }
      }
    };
    try {
      await walk(this.o.library);
      const missing = [...known.keys()].filter((p) => !present.has(p));
      const mark = this.db.prepare("update photos set missing = 1 where path = ?");
      tx(this.db, () => missing.forEach((p) => mark.run(p)));
      const back = this.db.prepare("update photos set missing = 0 where path = ? and missing = 1");
      tx(this.db, () => [...present].forEach((p) => back.run(p)));
    } finally {
      this.scanning = this.status.scanning = false;
      this.o.onChange("photos");
    }
  }

  private queueUnfinished() {
    const rows = this.db.prepare("select id from photos where missing = 0 and (thumb = 0 or hash is null)").all() as { id: number }[];
    this.work.push(...rows.map((r) => r.id));
    if (this.o.faces()) {
      const f = this.db.prepare("select id from photos where missing = 0 and thumb = 1 and faces_scanned = 0 and dup_of is null and pair_of is null").all() as { id: number }[];
      this.faceWork.push(...f.map((r) => r.id));
    }
  }

  // A new or changed file. A file with the same name and size that went
  // missing is the same photo moved or renamed, so its tags are kept.
  seen(file: string, size: number, mtimeMs: number) {
    if (this.skipped(file)) return;
    const place = placeFromPath(this.o.library, file);
    const mtime = Math.round(mtimeMs);
    const existing = this.db.prepare("select id, size, mtime from photos where path = ?").get(file) as Row | undefined;
    if (existing) {
      if (existing.size === size && existing.mtime === mtime) {
        this.db.prepare("update photos set missing = 0 where id = ?").run(existing.id as number);
        return;
      }
      this.db.prepare("update photos set size = ?, mtime = ?, hash = null, thumb = 0, missing = 0 where id = ?").run(size, mtime, existing.id as number);
      this.work.push(existing.id as number);
      return;
    }
    const moved = this.db
      .prepare("select id from photos where missing = 1 and name = ? and size = ? order by id limit 1")
      .get(path.basename(file), size) as Row | undefined;
    const fields = {
      year: place.year,
      term: place.term,
      event_key: place.event?.key ?? null,
      event_title: place.event?.title ?? null,
      event_date: place.event?.date ?? null,
      class_name: place.className,
    };
    if (moved) {
      this.db
        .prepare(
          "update photos set path = ?, missing = 0, mtime = ?, year = coalesce(?, year), term = coalesce(?, term), event_key = ?, event_title = ?, event_date = coalesce(?, event_date), class_name = ? where id = ?",
        )
        .run(file, mtime, fields.year, fields.term, fields.event_key, fields.event_title, fields.event_date, fields.class_name, moved.id as number);
      this.o.onChange("photos");
      return;
    }
    const r = this.db
      .prepare(
        `insert into photos (path, name, ext, size, mtime, is_raw, year, term, event_key, event_title, event_date, class_name, added_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        file,
        path.basename(file),
        path.extname(file).toLowerCase(),
        size,
        mtime,
        isRaw(file) ? 1 : 0,
        fields.year,
        fields.term,
        fields.event_key,
        fields.event_title,
        fields.event_date,
        fields.class_name,
        Date.now(),
      );
    this.work.push(Number(r.lastInsertRowid));
  }

  private gone(file: string) {
    this.db.prepare("update photos set missing = 1 where path = ?").run(file);
    this.o.onChange("photos");
  }

  private pump() {
    this.status.processing = this.work.length;
    this.status.faceQueue = this.faceWork.length;
    if (this.o.paused()) return;
    while (this.running < 3 && (this.work.length || this.faceWork.length)) {
      const id = this.work.shift();
      this.running++;
      const job = id !== undefined ? this.process(id) : this.scanFaces(this.faceWork.shift()!);
      job
        .catch((e) => this.o.log?.(String(e)))
        .finally(() => {
          this.running--;
          if (!this.work.length && !this.faceWork.length) this.o.onChange("status");
        });
    }
  }

  // Hash, thumbnail, date, size and quality for one photo.
  private process(id: number) {
    return exclusive(() => this.read(id));
  }

  private async read(id: number) {
    const p = this.db.prepare("select * from photos where id = ?").get(id) as Row | undefined;
    if (!p || p.missing) return;
    const file = p.path as string;
    try {
      const hash = await fileHash(file);
      const input = await source(file);
      const meta = await sharp(input, { failOn: "none" }).metadata();
      const rotated = (meta.orientation ?? 1) >= 5;
      const width = rotated ? meta.height : meta.width;
      const height = rotated ? meta.width : meta.height;
      let taken: Date | null = null;
      try {
        const tags = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
        const d = tags?.DateTimeOriginal ?? tags?.CreateDate;
        if (d instanceof Date && !Number.isNaN(d.getTime())) taken = d;
      } catch {
        // no date in the file
      }
      taken ??= new Date(p.mtime as number);
      await makeThumb(input, this.thumbPath(id), THUMB);
      const q = await measure(input);

      // Same bytes as another photo: a duplicate. Same name next to a RAW: one photo in two formats.
      const twin = this.db.prepare("select id from photos where hash = ? and id != ? and missing = 0 and dup_of is null order by id limit 1").get(hash, id) as Row | undefined;
      const dir = path.dirname(file);
      const base = path.basename(file, path.extname(file));
      let pairOf: number | null = null;
      if (p.is_raw) {
        const jpeg = this.db
          .prepare("select id from photos where path like ? escape '\\' and is_raw = 0 and missing = 0 and lower(name) like lower(?) limit 1")
          .get(like(dir + path.sep) , `${base}.%`) as Row | undefined;
        if (jpeg) pairOf = jpeg.id as number;
      } else {
        const raw = this.db
          .prepare("select id from photos where is_raw = 1 and missing = 0 and path like ? escape '\\' and lower(name) like lower(?)")
          .all(like(dir + path.sep), `${base}.%`) as Row[];
        for (const r of raw) this.db.prepare("update photos set pair_of = ? where id = ?").run(id, r.id as number);
      }
      const m = EDIT.exec(base);
      let editedOf: number | null = null;
      if (m) {
        const orig = this.db
          .prepare("select id from photos where path like ? escape '\\' and lower(name) like lower(?) and id != ? and missing = 0 limit 1")
          .get(like(dir + path.sep), `${m[1]}.%`, id) as Row | undefined;
        if (orig) editedOf = orig.id as number;
      }
      const year = (p.year as string) ?? schoolYear(taken);
      const termName = (p.term as string) ?? term(taken);
      this.db
        .prepare(
          `update photos set hash = ?, width = ?, height = ?, taken_at = ?, year = ?, term = ?, event_date = coalesce(event_date, ?),
           thumb = 1, sharpness = ?, brightness = ?, quality = ?, dhash = ?, dup_of = ?, pair_of = ?, edited_of = ? where id = ?`,
        )
        .run(
          hash,
          width ?? null,
          height ?? null,
          taken.toISOString(),
          year,
          termName,
          p.event_key ? isoDate(taken) : null,
          q.sharpness,
          q.brightness,
          q.quality,
          q.dhash,
          twin ? (twin.id as number) : null,
          pairOf,
          editedOf,
          id,
        );
      if (this.o.faces() && !twin && !pairOf) this.faceWork.push(id);
      this.o.onPhotoReady?.(id);
      this.o.onChange("photos");
    } catch (e) {
      this.o.log?.(`${path.basename(file)}: ${e instanceof Error ? e.message : e}`);
      this.db.prepare("update photos set thumb = -1 where id = ?").run(id);
    }
  }

  private scanFaces(id: number) {
    return exclusive(() => this.faces(id));
  }

  private async faces(id: number) {
    const p = this.db.prepare("select path, missing, faces_scanned, sharpness, brightness from photos where id = ?").get(id) as Row | undefined;
    if (!p || p.missing || p.faces_scanned) return;
    try {
      const faces = await findFaces(this.o.models, await source(p.path as string));
      const known = this.knownFaces();
      tx(this.db, () => {
        this.db.prepare("delete from faces where photo_id = ? and status in ('unknown', 'suggested')").run(id);
        const insert = this.db.prepare(
          "insert into faces (photo_id, x, y, w, h, score, embedding, status, suggest_id, suggest_score) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const f of faces) {
          const match = bestMatch(f.embedding, known);
          insert.run(id, f.box[0], f.box[1], f.box[2], f.box[3], f.score, toBlob(f.embedding), match ? "suggested" : "unknown", match?.studentId ?? null, match?.score ?? null);
        }
        const biggest = faces.reduce((m, f) => Math.max(m, f.box[2]), 0);
        this.db
          .prepare("update photos set faces_scanned = 1, face_count = ?, quality = ? where id = ?")
          .run(faces.length, score(p.sharpness as number, p.brightness as number, faces.length, biggest), id);
      });
      this.o.onChange("faces");
    } catch (e) {
      this.o.log?.(`faces ${path.basename(p.path as string)}: ${e instanceof Error ? e.message : e}`);
      this.db.prepare("update photos set faces_scanned = -1 where id = ?").run(id);
    }
  }

  queueFaceScan() {
    const rows = this.db
      .prepare("select id from photos where missing = 0 and thumb = 1 and faces_scanned = 0 and dup_of is null and pair_of is null")
      .all() as { id: number }[];
    const queued = new Set(this.faceWork);
    this.faceWork.push(...rows.map((r) => r.id).filter((id) => !queued.has(id)));
  }

  // Every face a person has confirmed, plus portraits: what suggestions are matched against.
  knownFaces() {
    const rows = this.db
      .prepare("select student_id, embedding from faces where student_id is not null and status in ('confirmed', 'portrait') and embedding is not null")
      .all() as { student_id: string; embedding: Uint8Array }[];
    return rows.map((r) => ({ studentId: r.student_id, embedding: fromBlob(r.embedding) }));
  }

  // After a confirmation, look again at faces nobody has named yet.
  rematch(studentIds?: string[]) {
    const known = this.knownFaces().filter((k) => !studentIds || studentIds.includes(k.studentId));
    if (!known.length) return 0;
    const rows = this.db
      .prepare("select id, embedding, suggest_id, suggest_score, rejected, status from faces where status in ('unknown', 'suggested') and embedding is not null")
      .all() as { id: number; embedding: Uint8Array; suggest_id: string | null; suggest_score: number | null; rejected: string; status: string }[];
    const update = this.db.prepare("update faces set status = 'suggested', suggest_id = ?, suggest_score = ? where id = ?");
    let changed = 0;
    tx(this.db, () => {
      for (const r of rows) {
        const rejected = r.rejected ? r.rejected.split(",") : [];
        const match = bestMatch(fromBlob(r.embedding), known.filter((k) => !rejected.includes(k.studentId)));
        if (match && match.score > (r.suggest_score ?? 0)) {
          update.run(match.studentId, match.score, r.id);
          changed++;
        }
      }
    });
    if (changed) this.o.onChange("faces");
    return changed;
  }

  // Groups of unnamed faces that look like the same child, biggest first,
  // so one name can be given to many photos at once.
  unknownGroups(limit = 60) {
    const rows = this.db
      .prepare(
        "select f.id, f.embedding from faces f join photos p on p.id = f.photo_id where f.status = 'unknown' and f.embedding is not null and p.missing = 0 and f.w > 0.025 order by f.id desc limit 2500",
      )
      .all() as { id: number; embedding: Uint8Array }[];
    const items = rows.map((r) => ({ id: r.id, e: fromBlob(r.embedding) }));
    const groups: { ids: number[]; centre: Float32Array }[] = [];
    for (const it of items) {
      let best: (typeof groups)[number] | null = null;
      let bestScore = 0.45;
      for (const g of groups) {
        const s = cosine(it.e, g.centre);
        if (s > bestScore) {
          bestScore = s;
          best = g;
        }
      }
      if (best) best.ids.push(it.id);
      else groups.push({ ids: [it.id], centre: it.e });
    }
    return groups
      .filter((g) => g.ids.length >= 2)
      .sort((a, b) => b.ids.length - a.ids.length)
      .slice(0, limit)
      .map((g) => g.ids);
  }

  // Portraits from the class list: the first known face of each child.
  async addPortraits(folder: string, students: StudentRow[]) {
    let added = 0;
    const files = await readdir(folder).catch(() => [] as string[]);
    const byName = new Map(files.map((f) => [f.toLowerCase(), f]));
    for (const s of students) {
      const name =
        (s.portrait && byName.get(s.portrait.toLowerCase())) ||
        [".jpg", ".jpeg", ".png", ".heic"].map((e) => byName.get(`${s.id.toLowerCase()}${e}`)).find(Boolean);
      if (!name) continue;
      try {
        const faces = await exclusive(() => findFaces(this.o.models, path.join(folder, name)));
        const face = faces.sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0];
        if (!face) continue;
        const portraitFile = path.join(this.o.cache, "portraits", `${safeName(s.id)}.jpg`);
        mkdirSync(path.dirname(portraitFile), { recursive: true });
        await exclusive(() => makeThumb(path.join(folder, name), portraitFile, 600));
        tx(this.db, () => {
          this.db.prepare("delete from faces where student_id = ? and status = 'portrait'").run(s.id);
          this.db.prepare("update students set portrait = ? where id = ?").run(portraitFile, s.id);
          this.db
            .prepare("insert into faces (photo_id, x, y, w, h, score, embedding, student_id, status, portrait) values (?, ?, ?, ?, ?, ?, ?, ?, 'portrait', 1)")
            .run(this.portraitPhoto(), face.box[0], face.box[1], face.box[2], face.box[3], face.score, toBlob(face.embedding), s.id);
        });
        added++;
      } catch (e) {
        this.o.log?.(`portrait ${name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (added) this.rematch();
    return added;
  }

  // Portrait faces need a photo row to hang on; one hidden placeholder holds them all.
  private portraitPhoto() {
    const p = this.db.prepare("select id from photos where path = ':portraits:'").get() as Row | undefined;
    if (p) return p.id as number;
    return Number(
      this.db
        .prepare("insert into photos (path, name, ext, size, mtime, missing, added_at, thumb) values (':portraits:', 'portraits', '', 0, 0, 2, ?, 1)")
        .run(Date.now()).lastInsertRowid,
    );
  }

  // Screens ask first, so their pictures jump the background queue.
  async preview(id: number) {
    const out = this.previewPath(id);
    if (existsSync(out)) return out;
    const p = this.db.prepare("select path from photos where id = ?").get(id) as Row | undefined;
    if (!p) throw new Error("no photo");
    await exclusive(async () => existsSync(out) || (await makeThumb(await source(p.path as string), out, PREVIEW)));
    return out;
  }

  async thumb(id: number) {
    const out = this.thumbPath(id);
    if (existsSync(out)) return out;
    const p = this.db.prepare("select path from photos where id = ?").get(id) as Row | undefined;
    if (!p) throw new Error("no photo");
    await exclusive(async () => existsSync(out) || (await makeThumb(await source(p.path as string), out, THUMB)));
    return out;
  }

  // A crop around one face for the review screens.
  faceCrop(faceId: number) {
    const out = path.join(this.o.cache, "faces", `${faceId}.jpg`);
    if (existsSync(out)) return Promise.resolve(out);
    return exclusive(() => this.cropFace(faceId));
  }

  private async cropFace(faceId: number) {
    const out = path.join(this.o.cache, "faces", `${faceId}.jpg`);
    if (existsSync(out)) return out;
    mkdirSync(path.dirname(out), { recursive: true });
    const f = this.db.prepare("select f.*, p.path, p.id as pid from faces f join photos p on p.id = f.photo_id where f.id = ?").get(faceId) as Row | undefined;
    if (!f) throw new Error("no face");
    let input: string;
    if (f.portrait) input = (this.db.prepare("select portrait from students where id = ?").get(f.student_id as string) as Row)?.portrait as string;
    else {
      input = this.previewPath(f.pid as number);
      if (!existsSync(input)) await makeThumb(await source(f.path as string), input, PREVIEW);
    }
    const img = sharp(input);
    const m = await img.metadata();
    const W = m.width!, H = m.height!;
    const x = f.x as number, y = f.y as number, w = f.w as number, h = f.h as number;
    if (!w) {
      await makeThumb(input, out, 200);
      return out;
    }
    const side = Math.max(w * W, h * H) * 1.7;
    const left = Math.max(0, Math.round((x + w / 2) * W - side / 2));
    const top = Math.max(0, Math.round((y + h / 2) * H - side / 2));
    await sharp(input)
      .extract({ left, top, width: Math.max(1, Math.min(Math.round(side), W - left)), height: Math.max(1, Math.min(Math.round(side), H - top)) })
      .resize(200, 200, { fit: "cover" })
      .jpeg({ quality: 82 })
      .toFile(out);
    return out;
  }

  // Duplicates go to the Mac's Bin, never deleted outright.
  duplicates() {
    return this.db
      .prepare(
        `select d.id, d.path, d.size, d.dup_of, o.path as original from photos d join photos o on o.id = d.dup_of
         where d.missing = 0 and o.missing = 0 order by d.dup_of, d.id`,
      )
      .all();
  }

  // Shots taken seconds apart that look the same: show one, keep the best.
  similarGroups(ids: number[]) {
    if (!ids.length) return [];
    const rows = this.db
      .prepare(`select id, dhash, taken_at, quality from photos where id in (${ids.map(() => "?").join(",")}) and dhash is not null order by taken_at`)
      .all(...ids) as { id: number; dhash: string; taken_at: string; quality: number }[];
    const groups: number[][] = [];
    let current: typeof rows = [];
    for (const r of rows) {
      const last = current.at(-1);
      if (last && hamming(last.dhash, r.dhash) <= 10 && Math.abs(Date.parse(r.taken_at) - Date.parse(last.taken_at)) < 15_000) current.push(r);
      else {
        if (current.length > 1) groups.push(current.map((c) => c.id));
        current = [r];
      }
    }
    if (current.length > 1) groups.push(current.map((c) => c.id));
    return groups;
  }

  // The best few photos of an event or class: quality first, one per burst,
  // and spread across different children where faces are known.
  bestPhotos(ids: number[], count: number) {
    if (!ids.length) return [];
    const rows = this.db
      .prepare(`select id, quality, flag, rating from photos where id in (${ids.map(() => "?").join(",")}) and flag >= 0`)
      .all(...ids) as { id: number; quality: number; flag: number; rating: number }[];
    const burst = new Map<number, number>();
    this.similarGroups(rows.map((r) => r.id)).forEach((g, i) => g.forEach((id) => burst.set(id, i)));
    const kids = new Map<number, string[]>();
    for (const f of this.db
      .prepare(`select photo_id, coalesce(student_id, suggest_id) s from faces where photo_id in (${rows.map(() => "?").join(",")}) and coalesce(student_id, suggest_id) is not null`)
      .all(...rows.map((r) => r.id)) as { photo_id: number; s: string }[]) {
      kids.set(f.photo_id, [...(kids.get(f.photo_id) ?? []), f.s]);
    }
    const value = (r: (typeof rows)[number]) => (r.quality ?? 0) + r.rating * 1.5 + (r.flag > 0 ? 4 : 0);
    const ranked = rows.sort((a, b) => value(b) - value(a));
    const chosen: number[] = [];
    const usedBursts = new Set<number>();
    const shown = new Map<string, number>();
    while (chosen.length < count && ranked.length) {
      let bestIndex = 0;
      let bestValue = -Infinity;
      ranked.forEach((r, i) => {
        const b = burst.get(r.id);
        const repeat = (kids.get(r.id) ?? []).reduce((s, k) => s + (shown.get(k) ?? 0), 0);
        const v = value(r) - (b !== undefined && usedBursts.has(b) ? 6 : 0) - repeat * 0.8;
        if (v > bestValue) {
          bestValue = v;
          bestIndex = i;
        }
      });
      const [r] = ranked.splice(bestIndex, 1);
      chosen.push(r.id);
      const b = burst.get(r.id);
      if (b !== undefined) usedBursts.add(b);
      for (const k of kids.get(r.id) ?? []) shown.set(k, (shown.get(k) ?? 0) + 1);
    }
    return chosen;
  }

  // Moves photos into another event folder (and class), keeping all tags.
  async moveTo(ids: number[], target: { title: string; date: string; className?: string | null }) {
    const date = new Date(`${target.date}T12:00:00`);
    let dir = eventFolder(this.o.library, date, target.title);
    if (target.className) dir = path.join(dir, safeName(target.className));
    const { mkdir, rename } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    const undo: { id: number; from: string }[] = [];
    for (const id of ids) {
      const p = this.db.prepare("select path from photos where id = ?").get(id) as Row | undefined;
      if (!p) continue;
      const from = p.path as string;
      const to = await freeName(path.join(dir, path.basename(from)));
      if (from === to) continue;
      await rename(from, to);
      const place = placeFromPath(this.o.library, to);
      this.db
        .prepare("update photos set path = ?, year = ?, term = ?, event_key = ?, event_title = ?, event_date = ?, class_name = ? where id = ?")
        .run(to, place.year, place.term, place.event?.key ?? null, place.event?.title ?? null, place.event?.date ?? null, place.className, id);
      undo.push({ id, from });
    }
    this.o.onChange("photos");
    return undo;
  }

  async moveBack(items: { id: number; from: string }[]) {
    const { mkdir, rename } = await import("node:fs/promises");
    for (const it of items) {
      const p = this.db.prepare("select path from photos where id = ?").get(it.id) as Row | undefined;
      if (!p) continue;
      await mkdir(path.dirname(it.from), { recursive: true });
      const to = await freeName(it.from);
      await rename(p.path as string, to);
      const place = placeFromPath(this.o.library, to);
      this.db
        .prepare("update photos set path = ?, year = ?, term = ?, event_key = ?, event_title = ?, event_date = ?, class_name = ? where id = ?")
        .run(to, place.year, place.term, place.event?.key ?? null, place.event?.title ?? null, place.event?.date ?? null, place.className, it.id);
    }
    this.o.onChange("photos");
  }

  // Renames an event folder; every photo keeps its tags.
  async renameEvent(eventKey: string, title: string, date: string) {
    const { rename } = await import("node:fs/promises");
    const from = path.join(this.o.library, ...eventKey.split("/"));
    const parent = path.dirname(from);
    const to = await freeName(path.join(parent, `${date} ${safeName(title)}`));
    await rename(from, to);
    const rows = this.db.prepare("select id, path from photos where event_key = ?").all(eventKey) as { id: number; path: string }[];
    tx(this.db, () => {
      for (const r of rows) {
        const np = to + r.path.slice(from.length);
        const place = placeFromPath(this.o.library, np);
        this.db
          .prepare("update photos set path = ?, event_key = ?, event_title = ?, event_date = ? where id = ?")
          .run(np, place.event?.key ?? null, place.event?.title ?? null, place.event?.date ?? null, r.id);
      }
    });
    this.o.onChange("photos");
  }

  async clearCache(id: number) {
    await rm(this.thumbPath(id), { force: true });
    await rm(this.previewPath(id), { force: true });
  }
}

const like = (prefix: string) => prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";

async function freeName(file: string) {
  if (!existsSync(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length || undefined);
  for (let n = 2; n < 1000; n++) {
    const f = `${base} (${n})${ext}`;
    if (!existsSync(f)) return f;
  }
  return file;
}

// Copies photos from a card, a photographer's folder or a watched folder into
// the library. Files already in the library (same bytes) are left out.
export async function importPhotos(o: {
  db: Db;
  library: string;
  files: string[];
  title: string;
  date: string | null;
  className: string | null;
  byDay: boolean;
  skipDuplicates: boolean;
  onProgress: (done: number, total: number) => void;
}) {
  let copied = 0, duplicates = 0, failed = 0;
  const folders = new Set<string>();
  const known = o.skipDuplicates ? new Set((o.db.prepare("select hash from photos where hash is not null").all() as { hash: string }[]).map((r) => r.hash)) : new Set<string>();
  for (let i = 0; i < o.files.length; i++) {
    const file = o.files[i];
    try {
      const hash = o.skipDuplicates ? await fileHash(file) : "";
      if (hash && known.has(hash)) {
        duplicates++;
        continue;
      }
      if (hash) known.add(hash);
      let date = o.date ? new Date(`${o.date}T12:00:00`) : null;
      if (!date || o.byDay) {
        try {
          const tags = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
          const d = tags?.DateTimeOriginal ?? tags?.CreateDate;
          if (d instanceof Date && !Number.isNaN(d.getTime())) date = d;
        } catch {
          // keep the chosen date
        }
        date ??= (await stat(file)).mtime;
      }
      let dir = eventFolder(o.library, date, o.title);
      if (o.className) dir = path.join(dir, safeName(o.className));
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      const dest = await freeName(path.join(dir, path.basename(file)));
      await copyFile(file, dest, constants.COPYFILE_EXCL);
      folders.add(dir);
      copied++;
    } catch {
      failed++;
    }
    o.onProgress(i + 1, o.files.length);
  }
  return { copied, duplicates, failed, folders: [...folders] };
}

export async function listFiles(dir: string, depth = 12): Promise<string[]> {
  if (depth < 0) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(full, depth - 1)));
    else if (e.isFile() && isLibraryFile(full)) out.push(full);
  }
  return out;
}

export { SAME_PERSON };
