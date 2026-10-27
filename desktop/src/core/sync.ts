import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { watch, type FSWatcher } from "chokidar";
import { eventFolder, eventFromPath, isoDate, isPhoto } from "./library";
import { exclusive } from "./lock";
import { fileHash, prepare } from "./photo";
import type { Job, UploadQueue } from "./queue";
import { JsonStore } from "./store";

export type SyncOptions = {
  supabase: SupabaseClient;
  queue: UploadQueue;
  eventsFile: string;
  schoolId: string;
  userId: string;
  library: string;
  backup: string | null;
  onChange: () => void;
  log?: (message: string) => void;
  // Off when the app's library decides what to send (see enqueue).
  watch?: boolean;
  allow?: (file: string) => boolean;
  paused?: () => boolean;
  onUploaded?: (file: string, hash: string, photoId: string | null) => void;
};

const MAX_ATTEMPTS = 8;
const PARALLEL = 2;

class BrokenPhoto extends Error {}

// Watches the library folder and uploads web copies of new photos, one
// event per folder. Safe to stop and start at any time.
export class LibrarySync {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = 0;
  private events: JsonStore<{ map: Record<string, string | null> }>;
  current: string[] = [];

  constructor(private o: SyncOptions) {
    this.events = new JsonStore(o.eventsFile, { map: {} });
  }

  start() {
    this.timer = setInterval(() => this.pump(), 2000);
    if (this.o.watch === false) return;
    this.watcher = watch(this.o.library, {
      ignoreInitial: false,
      alwaysStat: true,
      depth: 8,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 250 },
      ignored: (p, stats) => !!stats?.isFile() && !isPhoto(p),
    });
    this.watcher.on("add", (file, stats) => {
      if (this.o.allow && !this.o.allow(file)) return;
      const signature = stats ? `${stats.size}:${Math.round(stats.mtimeMs)}` : "";
      if (this.o.queue.add(file, signature)) this.o.onChange();
    });
    this.watcher.on("error", (e) => this.o.log?.(`watch error: ${String(e)}`));
  }

  // Asks for one photo to be sent; safe to call again for the same file.
  async enqueue(file: string) {
    const s = await stat(file).catch(() => null);
    if (!s) return false;
    const added = this.o.queue.add(file, `${s.size}:${Math.round(s.mtimeMs)}`);
    if (added) this.o.onChange();
    return added;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.watcher?.close();
    this.watcher = null;
  }

  private pump() {
    if (this.o.paused?.()) return;
    while (this.running < PARALLEL) {
      const job = this.o.queue.next();
      if (!job || this.current.includes(job.file)) return;
      this.running++;
      this.current.push(job.file);
      this.o.onChange();
      this.process(job).finally(() => {
        this.running--;
        this.current = this.current.filter((f) => f !== job.file);
        this.o.onChange();
      });
    }
  }

  private async process(job: Job) {
    const { queue } = this.o;
    try {
      await stat(job.file);
    } catch {
      queue.forget(job.file);
      return;
    }
    try {
      const hash = await fileHash(job.file);
      const id = queue.isDone(hash) ? null : await this.upload(job.file, hash);
      // Every original is backed up, even one already sent from another folder.
      if (this.o.backup) await this.backup(job.file);
      queue.finish(job, hash, id);
      this.o.onUploaded?.(job.file, hash, id ?? queue.photoId(hash));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.o.log?.(`${path.basename(job.file)}: ${message}`);
      if (e instanceof BrokenPhoto || job.attempts + 1 >= MAX_ATTEMPTS) queue.fail(job, message);
      else queue.retryLater(job, message);
    }
  }

  private async upload(file: string, hash: string) {
    const { supabase, schoolId, userId } = this.o;
    const prepared = await exclusive(() => prepare(file)).catch(() => {
      throw new BrokenPhoto("Can't read this photo file");
    });
    const eventId = await this.eventFor(file, prepared.takenAt);

    const id = randomUUID();
    const storagePath = `${schoolId}/${id}.jpg`;
    const thumbPath = `${schoolId}/${id}_t.jpg`;
    const bucket = supabase.storage.from("photos");
    const options = { contentType: "image/jpeg", upsert: false };
    const [a, b] = await Promise.all([bucket.upload(storagePath, prepared.full, options), bucket.upload(thumbPath, prepared.thumb, options)]);
    if (a.error || b.error) throw new Error((a.error ?? b.error)!.message);

    const { error } = await supabase.from("photos").insert({
      id,
      school_id: schoolId,
      event_id: eventId,
      uploaded_by: userId,
      source: "desktop",
      storage_path: storagePath,
      width: prepared.width,
      height: prepared.height,
      size_bytes: prepared.full.byteLength,
      source_key: hash,
      original_name: path.basename(file).slice(0, 260),
      taken_at: prepared.takenAt?.toISOString() ?? null,
    });
    if (error) {
      await bucket.remove([storagePath, thumbPath]);
      if (error.code === "23505") return null; // already in the library from another computer
      throw new Error(error.message);
    }
    return id;
  }

  async eventFor(file: string, takenAt: Date | null) {
    const folder = eventFromPath(this.o.library, file);
    if (!folder) return null;
    const cached = this.events.get().map[folder.key];
    if (cached !== undefined) return cached;

    const { supabase, schoolId, userId } = this.o;
    const date = folder.date ?? isoDate(takenAt ?? (await stat(file)).mtime);
    const { data: found, error: findError } = await supabase
      .from("events")
      .select("id")
      .eq("school_id", schoolId)
      .eq("title", folder.title)
      .eq("event_date", date)
      .limit(1)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    let id: string | null = found?.id ?? null;
    if (!id) {
      const { data, error } = await supabase
        .from("events")
        .insert({ school_id: schoolId, title: folder.title, event_date: date, created_by: userId })
        .select("id")
        .single();
      // A teacher account can't create events; their photos still upload.
      id = error ? null : data.id;
    }
    this.events.set({ map: { ...this.events.get().map, [folder.key]: id } });
    return id;
  }

  private async backup(file: string) {
    const rel = path.relative(this.o.library, file);
    const target = path.join(this.o.backup!, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target, constants.COPYFILE_EXCL).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
  }
}

async function listPhotos(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".")) return listPhotos(full);
      return Promise.resolve(e.isFile() && isPhoto(full) ? [full] : []);
    }),
  );
  return nested.flat();
}

// Copies photos from a memory card or a photographer's folder into the
// library, filed as <year>/<term>/<date event>. The watcher then uploads them.
export async function importFolder(library: string, source: string, eventName: string, date: Date) {
  const target = eventFolder(library, date, eventName);
  if (path.resolve(source).startsWith(path.resolve(library) + path.sep)) throw new Error("That folder is already inside the library");
  await mkdir(target, { recursive: true });
  let copied = 0;
  for (const file of await listPhotos(source)) {
    const ext = path.extname(file);
    const name = path.basename(file, ext);
    for (let n = 1; n < 1000; n++) {
      const dest = path.join(target, n === 1 ? `${name}${ext}` : `${name} (${n})${ext}`);
      try {
        await copyFile(file, dest, constants.COPYFILE_EXCL);
        copied++;
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
  }
  return { copied, target };
}
