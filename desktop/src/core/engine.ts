import { existsSync, mkdirSync } from "node:fs";
import { copyFile, readdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import exifr from "exifr";
import sharp from "sharp";
import { fromBlob, toBlob, tx, type Db } from "./db";
import { assignPhoto, cosine, findFaces, guessTraits, isSure, ranked, SAME_PERSON, SHOW_FROM, traitCentres, type Recogniser, type VisionFace } from "./faces";
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
  // Faces named by themselves (sure matches), so the website learns which
  // photos show a student who can't appear.
  onNamed?: (photoIds: number[]) => void;
  log?: (m: string) => void;
  // The downloaded AuraFace model, when it's on this computer.
  aura?: () => string | null;
  // Apple Vision on the Mac (a second look at each face).
  vision?: (jpeg: Buffer) => Promise<VisionFace[] | null>;
  // Settings: name sure matches by themselves (on by default).
  autoName?: () => boolean;
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
    // "_" folders (for example "_Staff", and the app's own "_Bin") are never read or sent.
    if (rel.split(path.sep).some((p) => p.startsWith(".") || p.startsWith("_") || p === "Bin")) return true;
    // "Drop here" sorts itself: its photos are filed by the importer first.
    if (rel.split(path.sep)[0] === "Drop here") return true;
    const skips = this.db.prepare("select path from folders where skip = 1").all() as { path: string }[];
    return skips.some((s) => file === s.path || file.startsWith(s.path + path.sep));
  }

  // 0.3 could name one person twice in a photo. Keep the strongest face for
  // each person in each photo; the others go back to "Who is this?".
  dedupePeople() {
    const rows = this.db
      .prepare(
        `select f.id, f.photo_id, coalesce(f.student_id, f.suggest_id) sid, f.status, f.auto, coalesce(f.suggest_score, 1) sc from faces f
         where coalesce(f.student_id, f.suggest_id) is not null and f.status in ('confirmed', 'suggested', 'manual') and f.w > 0
         order by f.photo_id, sid, (f.status in ('confirmed', 'manual') and f.auto = 0) desc, sc desc`,
      )
      .all() as { id: number; photo_id: number; sid: string; status: string; auto: number }[];
    const seen = new Set<string>();
    const reset: number[] = [];
    for (const r of rows) {
      const k = `${r.photo_id}|${r.sid}`;
      if (!seen.has(k)) seen.add(k);
      else if (r.status === "suggested" || r.auto) reset.push(r.id);
    }
    const up = this.db.prepare("update faces set status = 'unknown', student_id = null, suggest_id = null, suggest_score = null, auto = 0 where id = ?");
    tx(this.db, () => reset.forEach((id) => up.run(id)));
    return reset.length;
  }

  // Libraries from 0.3 have no "problems" yet: fill them from what is known.
  backfillProblems() {
    const rows = this.db.prepare("select id, sharpness, brightness from photos where problems is null and sharpness is not null").all() as { id: number; sharpness: number; brightness: number }[];
    const up = this.db.prepare("update photos set problems = ? where id = ?");
    tx(this.db, () => rows.forEach((r) => up.run(photoProblems(r.sharpness, r.brightness, []) ?? "", r.id)));
    return rows.length;
  }

  async start() {
    this.backfillProblems();
    const fixed = this.dedupePeople();
    if (fixed) this.o.log?.(`one person per photo: ${fixed} faces freed`);
    this.timer = setInterval(() => this.pump(), 400);
    this.watcher = watch(this.o.library, {
      ignoreInitial: true,
      alwaysStat: true,
      depth: 10,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 },
      ignored: (p, stats) => path.basename(p).startsWith(".") || (path.basename(p).startsWith("_") && p !== this.o.library) || (!!stats?.isFile() && !isLibraryFile(p)),
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
      // Photos moved to the archive drive live outside the library: they are not missing.
      const missing = [...known.keys()].filter((p) => !present.has(p) && !path.relative(this.o.library, p).startsWith(".."));
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
      // The same photo was in the library before and its file went missing
      // (folder deleted, drive changed): this file takes the old record's
      // place, so names, faces, picks and posts all carry over.
      const lost = this.db.prepare("select id from photos where hash = ? and missing = 1 and id != ? and path not like ':%' order by id limit 1").get(hash, id) as Row | undefined;
      if (lost) {
        const lostId = lost.id as number;
        tx(this.db, () => {
          this.db.prepare("delete from photos where id = ?").run(id);
          this.db.prepare("update photos set path = ?, name = ?, size = ?, mtime = ?, missing = 0, year = coalesce(?, year), term = coalesce(?, term), event_key = ?, event_title = ?, event_date = coalesce(?, event_date), class_name = ? where id = ?").run(
            file, path.basename(file), p.size as number, p.mtime as number, p.year as string | null, p.term as string | null, p.event_key as string | null, p.event_title as string | null, p.event_date as string | null, p.class_name as string | null, lostId,
          );
        });
        await this.clearCache(id);
        await rm(this.previewPath(lostId), { force: true });
        if (!existsSync(this.thumbPath(lostId))) await makeThumb(await source(file), this.thumbPath(lostId), THUMB);
        this.o.log?.(`relinked ${path.basename(file)}`);
        this.o.onPhotoReady?.(lostId);
        this.o.onChange("photos");
        return;
      }
      const input = await source(file);
      const meta = await sharp(input, { failOn: "none" }).metadata();
      const rotated = (meta.orientation ?? 1) >= 5;
      const width = rotated ? meta.height : meta.width;
      const height = rotated ? meta.width : meta.height;
      let taken: Date | null = null;
      let camera: string | null = null;
      try {
        const tags = await exifr.parse(file, ["DateTimeOriginal", "CreateDate", "Model"]);
        const d = tags?.DateTimeOriginal ?? tags?.CreateDate;
        if (d instanceof Date && !Number.isNaN(d.getTime())) taken = d;
        if (tags?.Model) camera = String(tags.Model).trim().slice(0, 60);
      } catch {
        // no date in the file
      }
      taken ??= new Date(p.mtime as number);
      // Copied in by an import: its camera clock fix, photographer and kind of photo.
      const imp = this.db.prepare("select * from import_files where path = ?").get(file) as Row | undefined;
      if (imp) {
        if (imp.offset_ms) taken = new Date(taken.getTime() + (imp.offset_ms as number));
        this.db.prepare("update photos set import_id = ?, photographer = coalesce(?, photographer), category = coalesce(?, category) where id = ?").run(imp.import_id as number | null, (imp.photographer as string) || null, (imp.category as string) || null, id);
      }
      if (camera) this.db.prepare("update photos set camera = ? where id = ?").run(camera, id);
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
      this.db.prepare("update photos set problems = ? where id = ?").run(photoProblems(q.sharpness, q.brightness, []), id);
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
    const p = this.db.prepare("select path, missing, faces_scanned, sharpness, brightness, class_name, coalesce(taken_at, event_date) as at from photos where id = ?").get(id) as Row | undefined;
    if (!p || p.missing || p.faces_scanned) return;
    try {
      const found = await findFaces(this.o.models, await source(p.path as string), { aura: this.o.aura?.() ?? null, vision: this.o.vision });
      const model = found.recogniser ?? "sface";
      // Faces seen before in this photo (a re-scan, a new recogniser): the
      // same box keeps its name, its "not this person" list and "not a face".
      const old = this.db.prepare("select * from faces where photo_id = ? and portrait = 0").all(id) as Row[];
      const kept = new Map<number, Row>();
      found.forEach((f, i) => {
        const o = old.find((r) => (r.w as number) > 0 && boxIou([r.x as number, r.y as number, r.w as number, r.h as number], f.box) > 0.4 && ![...kept.values()].includes(r));
        if (o) kept.set(i, o);
      });
      const named = new Set([...kept.values()].filter((r) => ["confirmed", "manual"].includes(r.status as string) && r.student_id).map((r) => r.student_id as string));
      for (const r of old) if ((r.w as number) === 0 && r.student_id) named.add(r.student_id as string); // tagged with no face box
      const known = this.knownFor(p.class_name as string | null, p.at as string | null, this.knownFaces(model));
      const traits = traitCentres(known, found[0]?.embedding.length ?? 0);
      const people = this.peopleInfo();
      const fits = (i: number, sid: string) => {
        const f = found[i];
        const who = people.get(sid);
        if (!f || !who) return true;
        const rej = kept.get(i)?.rejected as string | undefined;
        if (rej && rej.split(",").includes(sid)) return false;
        const t = guessTraits(f.embedding, traits);
        if (t.gender && who.gender && t.gender !== who.gender) return false;
        if (t.adult === true && who.kind === "student") return false;
        if (t.adult === false && who.kind !== "student") return false;
        return true;
      };
      const free = found.map((f, i) => {
        const k = kept.get(i);
        return f.usable && !(k && ["confirmed", "manual", "rejected"].includes(k.status as string) && !(k.status === "confirmed" && k.auto)) ? f.embedding : null;
      });
      const matches = assignPhoto(free, known, model, named, fits);
      tx(this.db, () => {
        this.db.prepare("delete from faces where photo_id = ? and portrait = 0 and w > 0").run(id);
        const insert = this.db.prepare(
          "insert into faces (photo_id, x, y, w, h, score, embedding, status, student_id, suggest_id, suggest_score, auto, rejected, model, why, named_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        found.forEach((f, i) => {
          const k = kept.get(i);
          const blob = toBlob(f.embedding);
          if (k && (["confirmed", "manual", "rejected"].includes(k.status as string) && !(k.status === "confirmed" && k.auto))) {
            insert.run(id, f.box[0], f.box[1], f.box[2], f.box[3], f.score, blob, k.status === "manual" ? "confirmed" : (k.status as string), (k.student_id as string) ?? null, null, null, 0, (k.rejected as string) ?? "", model, null, (k.named_by as string) ?? null);
            return;
          }
          if (!f.usable) {
            insert.run(id, f.box[0], f.box[1], f.box[2], f.box[3], f.score, blob, "background", null, null, null, 0, (k?.rejected as string) ?? "", model, f.why, null);
            return;
          }
          const m = matches[i];
          const twin = m ? this.isTwin(m.studentId) : false;
          const sure = isSure(m ? { ...m, twin } : null) && this.o.autoName?.() !== false;
          insert.run(id, f.box[0], f.box[1], f.box[2], f.box[3], f.score, blob, sure ? "confirmed" : m && m.score >= SHOW_FROM - 0.1 ? "suggested" : "unknown", sure ? m!.studentId : null, m?.studentId ?? null, m?.score ?? null, sure ? 1 : 0, (k?.rejected as string) ?? "", model, null, sure ? "auto" : null);
        });
        const usable = found.filter((f) => f.usable);
        const biggest = usable.reduce((mx, f) => Math.max(mx, f.box[2]), 0);
        // Smiles, from the face points: a wider mouth for the distance
        // between the eyes. Used by the smile finder and "Best photos".
        const smiles = usable.map((f) => smileOf(f.landmarks)).filter((v): v is number => v !== null);
        const smile = smiles.length ? smiles.reduce((a, b) => a + b, 0) / smiles.length : null;
        const problems = photoProblems(p.sharpness as number, p.brightness as number, usable.map((f) => f.box));
        this.db
          .prepare("update photos set faces_scanned = 1, face_count = ?, quality = ?, smile = ?, problems = ? where id = ?")
          .run(usable.length, score(p.sharpness as number, p.brightness as number, usable.length, biggest) + (smile ? Math.max(0, smile - 0.85) * 4 : 0), smile, problems, id);
      });
      this.o.onChange("faces");
      this.o.onNamed?.([id]);
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

  // The new recogniser arrived: every photo is looked at again in the
  // background. Names, "not this person" and "not a face" carry over.
  rescanAll() {
    this.db.prepare("update photos set faces_scanned = 0 where faces_scanned != 0 and missing = 0").run();
    this.queueFaceScan();
  }

  get faceModel(): "sface" | "aura" {
    return this.o.aura?.() ? "aura" : "sface";
  }

  private peopleCache: { at: number; map: Map<string, { gender: string | null; kind: string; joined: string | null; left: string | null }> } | null = null;
  private peopleInfo() {
    if (this.peopleCache && Date.now() - this.peopleCache.at < 5000) return this.peopleCache.map;
    const map = new Map<string, { gender: string | null; kind: string; joined: string | null; left: string | null }>();
    for (const r of this.db.prepare("select id, gender, kind, joined, left_on from students").all() as Row[]) {
      const g = String(r.gender ?? "").trim().toUpperCase();
      map.set(r.id as string, { gender: g.startsWith("F") || g.startsWith("G") || g === "أنثى" ? "F" : g.startsWith("M") || g.startsWith("B") || g === "ذكر" ? "M" : null, kind: (r.kind as string) || "student", joined: (r.joined as string) ?? null, left: (r.left_on as string) ?? null });
    }
    this.peopleCache = { at: Date.now(), map };
    return map;
  }

  // Twins and look-alike siblings in the same grade need a clearer lead.
  private isTwin(studentId: string) {
    return !!this.db.prepare("select 1 from links where (a = ? or b = ?) and kind = 'twin' limit 1").get(studentId, studentId);
  }

  // Every face a person has confirmed, plus portraits: what suggestions are
  // matched against. Only faces made by the same recogniser can be compared.
  knownFaces(model = this.faceModel) {
    const rows = this.db
      .prepare(
        `select f.student_id, f.embedding, s.class_name, s.kind, s.gender, coalesce(p.taken_at, p.event_date) at from faces f left join students s on s.id = f.student_id left join photos p on p.id = f.photo_id
         where f.student_id is not null and f.status in ('confirmed', 'portrait') and f.auto = 0 and f.embedding is not null and f.model = ?`,
      )
      .all(model) as { student_id: string; embedding: Uint8Array; class_name: string | null; kind: string | null; gender: string | null; at: string | null }[];
    const info = this.peopleInfo();
    return rows.map((r) => ({ studentId: r.student_id, embedding: fromBlob(r.embedding), className: r.class_name, kind: r.kind ?? "student", gender: info.get(r.student_id)?.gender ?? null, at: r.at }));
  }

  // A class photo is matched against that class (and the adults) first;
  // whole-school events (no class folder) against everyone. Students who had
  // left, or hadn't joined yet, on the photo's date are never suggested.
  private knownFor(className: string | null, at: string | null, known = this.knownFaces()) {
    const info = this.peopleInfo();
    const day = at?.slice(0, 10) ?? null;
    // Students change as they grow: examples more than two years away from
    // this photo count a little less, so recent faces lead.
    const year = day ? Number(day.slice(0, 4)) : null;
    if (year) known = known.map((k) => (k.at && k.kind === "student" ? { ...k, penalty: 0.03 * Math.max(0, Math.abs(Number(k.at.slice(0, 4)) - year) - 2) } : k));
    const inTime = known.filter((k) => {
      const p = info.get(k.studentId);
      if (!p || !day) return !p?.left;
      if (p.joined && day < p.joined) return false;
      if (p.left && day > p.left) return false;
      return true;
    });
    if (!className) return inTime;
    const mine = inTime.filter((k) => k.className === className || k.kind !== "student");
    return mine.some((k) => k.kind === "student") ? mine : inTime;
  }

  // The three most likely people for one face (the "1 2 3" guesses), with
  // the same checks as suggestions: once per photo, not someone said "no"
  // to, boy or girl, student or adult.
  guesses(faceId: number, n = 3) {
    const f = this.db
      .prepare("select f.id, f.photo_id, f.embedding, f.model, f.rejected, p.class_name, coalesce(p.taken_at, p.event_date) at from faces f join photos p on p.id = f.photo_id where f.id = ?")
      .get(faceId) as { id: number; photo_id: number; embedding: Uint8Array | null; model: string; rejected: string; class_name: string | null; at: string | null } | undefined;
    if (!f?.embedding) return [];
    const model = (f.model as Recogniser) ?? "sface";
    const all = this.knownFaces(model);
    const known = this.knownFor(f.class_name, f.at, all);
    const emb = fromBlob(f.embedding);
    const taken = new Set((this.db.prepare("select student_id from faces where photo_id = ? and id != ? and status in ('confirmed', 'manual') and student_id is not null").all(f.photo_id, f.id) as { student_id: string }[]).map((r) => r.student_id));
    const rejected = new Set((f.rejected ?? "").split(",").filter(Boolean));
    const traits = traitCentres(all, emb.length);
    const t = guessTraits(emb, traits);
    const info = this.peopleInfo();
    return ranked(emb, known, model)
      .filter((c) => !taken.has(c.studentId) && !rejected.has(c.studentId))
      .filter((c) => {
        const who = info.get(c.studentId);
        if (!who) return true;
        if (t.gender && who.gender && t.gender !== who.gender) return false;
        if (t.adult === true && who.kind === "student") return false;
        if (t.adult === false && who.kind !== "student") return false;
        return true;
      })
      .slice(0, n);
  }

  // After a confirmation, look again at every face nobody has named yet, in
  // small batches so the app stays quick. Sure matches are named by themselves.
  private rematchTimer: NodeJS.Timeout | null = null;
  rematchSoon() {
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
    this.rematchTimer = setTimeout(() => {
      this.rematchTimer = null;
      this.rematch();
    }, 1200);
  }

  rematch(studentIds?: string[]) {
    const model = this.faceModel;
    const all = this.knownFaces(model);
    if (!all.length) return 0;
    const rows = this.db
      .prepare(
        `select f.id, f.photo_id, f.embedding, f.suggest_id, f.suggest_score, f.rejected, f.status, p.class_name, coalesce(p.taken_at, p.event_date) as at from faces f join photos p on p.id = f.photo_id
         where f.status in ('unknown', 'suggested') and f.embedding is not null and f.model = ? and p.missing = 0 order by f.photo_id`,
      )
      .all(model) as { id: number; photo_id: number; embedding: Uint8Array; suggest_id: string | null; suggest_score: number | null; rejected: string; status: string; class_name: string | null; at: string | null }[];
    const update = this.db.prepare("update faces set status = ?, suggest_id = ?, suggest_score = ? where id = ?");
    const name = this.db.prepare("update faces set status = 'confirmed', student_id = ?, suggest_id = ?, suggest_score = ?, auto = 1, named_by = 'auto' where id = ?");
    const namedIn = this.db.prepare("select student_id from faces where photo_id = ? and status in ('confirmed', 'manual') and student_id is not null");
    const traits = traitCentres(all, all[0]?.embedding.length ?? 0);
    const info = this.peopleInfo();
    const named: number[] = [];
    let changed = 0;
    const byPhoto = new Map<number, typeof rows>();
    for (const r of rows) byPhoto.set(r.photo_id, [...(byPhoto.get(r.photo_id) ?? []), r]);
    tx(this.db, () => {
      for (const [photoId, faces] of byPhoto) {
        const taken = new Set((namedIn.all(photoId) as { student_id: string }[]).map((x) => x.student_id));
        const known = this.knownFor(faces[0].class_name, faces[0].at, all);
        const embs = faces.map((f) => fromBlob(f.embedding));
        const matches = assignPhoto(embs, known, model, taken, (i, sid) => {
          if ((faces[i].rejected ? faces[i].rejected.split(",") : []).includes(sid)) return false;
          const who = info.get(sid);
          const t = guessTraits(embs[i], traits);
          if (who && t.gender && who.gender && t.gender !== who.gender) return false;
          if (who && t.adult === true && who.kind === "student") return false;
          if (who && t.adult === false && who.kind !== "student") return false;
          return true;
        });
        faces.forEach((r, i) => {
          const m = matches[i];
          if (studentIds && m && !studentIds.includes(m.studentId) && r.suggest_id === m.studentId) return;
          if (m && isSure({ ...m, twin: this.isTwin(m.studentId) }) && this.o.autoName?.() !== false) {
            name.run(m.studentId, m.studentId, m.score, r.id);
            named.push(r.id);
            changed++;
          } else if (m && (m.studentId !== r.suggest_id || Math.abs(m.score - (r.suggest_score ?? 0)) > 0.005)) {
            update.run(m.score >= SHOW_FROM - 0.1 ? "suggested" : "unknown", m.studentId, m.score, r.id);
            changed++;
          } else if (!m && r.suggest_id) {
            update.run("unknown", null, null, r.id);
            changed++;
          }
        });
      }
    });
    if (changed) this.o.onChange("faces");
    if (named.length) {
      const photos = this.db.prepare(`select distinct photo_id from faces where id in (${named.map(() => "?").join(",")})`).all(...named) as { photo_id: number }[];
      this.o.onNamed?.(photos.map((p) => p.photo_id));
    }
    return changed;
  }

  // Groups of unnamed faces that look like the same student, biggest first,
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

  // Portraits from the class list: the first known face of each student.
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
        const faces = await exclusive(() => findFaces(this.o.models, path.join(folder, name), { aura: this.o.aura?.() ?? null }));
        const face = faces.sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0];
        if (!face) continue;
        const portraitFile = path.join(this.o.cache, "portraits", `${safeName(s.id)}.jpg`);
        mkdirSync(path.dirname(portraitFile), { recursive: true });
        await exclusive(() => makeThumb(path.join(folder, name), portraitFile, 600));
        tx(this.db, () => {
          this.db.prepare("delete from faces where student_id = ? and status = 'portrait'").run(s.id);
          this.db.prepare("update students set portrait = ? where id = ?").run(portraitFile, s.id);
          this.db
            .prepare("insert into faces (photo_id, x, y, w, h, score, embedding, student_id, status, portrait, model) values (?, ?, ?, ?, ?, ?, ?, ?, 'portrait', 1, ?)")
            .run(this.portraitPhoto(), face.box[0], face.box[1], face.box[2], face.box[3], face.score, toBlob(face.embedding), s.id, faces.recogniser ?? "sface");
        });
        added++;
      } catch (e) {
        this.o.log?.(`portrait ${name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (added) this.rematch();
    return added;
  }

  // A new recogniser: portraits are described again from the saved copies.
  async reembedPortraits() {
    const rows = this.db.prepare("select id, portrait from students where portrait is not null").all() as { id: string; portrait: string }[];
    for (const r of rows) {
      if (!existsSync(r.portrait)) continue;
      try {
        const faces = await exclusive(() => findFaces(this.o.models, r.portrait, { aura: this.o.aura?.() ?? null }));
        const face = faces.sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0];
        if (!face) continue;
        this.db.prepare("insert into faces (photo_id, x, y, w, h, score, embedding, student_id, status, portrait, model) values (?, ?, ?, ?, ?, ?, ?, ?, 'portrait', 1, ?)").run(
          this.portraitPhoto(), face.box[0], face.box[1], face.box[2], face.box[3], face.score, toBlob(face.embedding), r.id, faces.recogniser ?? "sface",
        );
      } catch (e) {
        this.o.log?.(`portrait ${r.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
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

  // Screens ask first, so their pictures jump the background queue. When
  // the big picture can't be made (the original is missing or unreadable),
  // the thumbnail is shown instead of a broken picture.
  async preview(id: number) {
    const out = this.previewPath(id);
    if (existsSync(out)) return out;
    const p = this.db.prepare("select path from photos where id = ?").get(id) as Row | undefined;
    if (!p) throw new Error("no photo");
    try {
      if (!existsSync(p.path as string)) throw new Error("original missing");
      await exclusive(async () => existsSync(out) || (await makeThumb(await source(p.path as string), out, PREVIEW)));
      return out;
    } catch (e) {
      this.o.log?.(`preview ${path.basename(p.path as string)}: ${e instanceof Error ? e.message : e}`);
      await rm(out, { force: true }).catch(() => {});
      const thumb = this.thumbPath(id);
      if (existsSync(thumb)) return thumb;
      throw e;
    }
  }

  // Is the original file there? (The viewer says "Original missing" if not.)
  originalThere(id: number) {
    const p = this.db.prepare("select path from photos where id = ?").get(id) as Row | undefined;
    return !!p && existsSync(p.path as string);
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
  // and spread across different students where faces are known.
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
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    const undo: { id: number; from: string }[] = [];
    for (const id of ids) {
      const p = this.db.prepare("select path from photos where id = ?").get(id) as Row | undefined;
      if (!p) continue;
      const from = p.path as string;
      const to = await freeName(path.join(dir, path.basename(from)));
      if (from === to) continue;
      await moveFile(from, to);
      const place = placeFromPath(this.o.library, to);
      this.db
        .prepare("update photos set path = ?, year = ?, term = ?, event_key = ?, event_title = ?, event_date = ?, class_name = ?, missing = 0 where id = ?")
        .run(to, place.year, place.term, place.event?.key ?? null, place.event?.title ?? null, place.event?.date ?? null, place.className, id);
      // The big picture is made again from the file in its new place.
      await rm(this.previewPath(id), { force: true });
      undo.push({ id, from });
    }
    this.o.onChange("photos");
    for (const u of undo) this.preview(u.id).catch(() => {});
    return undo;
  }

  async moveBack(items: { id: number; from: string }[]) {
    const { mkdir } = await import("node:fs/promises");
    for (const it of items) {
      const p = this.db.prepare("select path from photos where id = ?").get(it.id) as Row | undefined;
      if (!p) continue;
      await mkdir(path.dirname(it.from), { recursive: true });
      const to = await freeName(it.from);
      await moveFile(p.path as string, to);
      await rm(this.previewPath(it.id), { force: true });
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

// Mouth width over eye distance: about 0.8 to 0.9 for a still face, more
// when smiling. YuNet points: right eye, left eye, nose, right and left mouth corners.
export function smileOf(l: number[]) {
  if (!l || l.length < 10) return null;
  const eyes = Math.hypot(l[2] - l[0], l[3] - l[1]);
  const mouth = Math.hypot(l[8] - l[6], l[9] - l[7]);
  return eyes > 0 ? mouth / eyes : null;
}

// What might be wrong with a photo, in words the Library shows as badges.
export function photoProblems(sharpness: number | null, brightness: number | null, faces: number[][]) {
  const out: string[] = [];
  if (sharpness !== null && sharpness < 25) out.push("blurry");
  if (brightness !== null && brightness < 0.11) out.push("dark");
  if (brightness !== null && brightness > 0.92) out.push("bright");
  if (faces.some((b) => b[1] < 0.004 && b[3] > 0.06)) out.push("head-cut");
  if (faces.length >= 1 && faces.every((b) => b[2] < 0.025)) out.push("faces-small");
  return out.join(",") || null;
}

function boxIou(a: number[], b: number[]) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}

const like = (prefix: string) => prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";

// A rename, or a copy and delete when the library spans two drives.
export async function moveFile(from: string, to: string) {
  const { rename, unlink } = await import("node:fs/promises");
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await copyFile(from, to, constants.COPYFILE_EXCL);
    await unlink(from);
  }
}

export async function freeName(file: string) {
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
  // Only photos whose file is really there count as "already in the
  // library". A photo whose file went missing is copied again, and the
  // library gives it back its old names, faces and picks (Engine.read).
  const present = (o.db.prepare("select hash, path from photos where hash is not null and missing = 0").all() as { hash: string; path: string }[]).filter((r) => existsSync(r.path));
  const known = o.skipDuplicates ? new Set(present.map((r) => r.hash)) : new Set<string>();
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
