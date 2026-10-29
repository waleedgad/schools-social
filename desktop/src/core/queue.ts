import { JsonStore } from "./store";

export type Job = { file: string; signature: string; addedAt: number; attempts: number; nextTry: number; error?: string };
type QueueData = { pending: Job[]; failed: Job[]; done: Record<string, string>; seen: Record<string, string> };

// Photos waiting to upload. Kept on disk, so nothing is lost when the
// internet is down or the computer restarts. "done" maps a file's content
// hash to its photo id, so a photo is never sent twice, and "seen" maps a
// file to its size and date, so a restart doesn't re-read the whole library.
export class UploadQueue {
  private store: JsonStore<QueueData>;

  constructor(file: string) {
    this.store = new JsonStore<QueueData>(file, { pending: [], failed: [], done: {}, seen: {} });
  }

  add(file: string, signature: string) {
    const { pending, failed, seen } = this.store.get();
    if (seen[file] === signature) return false;
    if (pending.some((j) => j.file === file) || failed.some((j) => j.file === file)) return false;
    this.store.set({ pending: [...pending, { file, signature, addedAt: Date.now(), attempts: 0, nextTry: 0 }] });
    return true;
  }

  next(now = Date.now()) {
    return this.store.get().pending.find((j) => j.nextTry <= now) ?? null;
  }

  find(file: string) {
    return this.store.get().pending.find((j) => j.file === file) ?? null;
  }

  // Waiting, not yet sent, and no longer wanted (a pick was cleared).
  cancel(files: string[]) {
    const set = new Set(files);
    const { pending } = this.store.get();
    const left = pending.filter((j) => !set.has(j.file));
    if (left.length !== pending.length) this.store.set({ pending: left });
    return pending.length - left.length;
  }

  photoId(hash: string) {
    return this.store.get().done[hash] || null;
  }

  isDone(hash: string) {
    return hash in this.store.get().done;
  }

  finish(job: Job, hash: string, photoId: string | null) {
    const { pending, done, seen } = this.store.get();
    this.store.set({
      pending: pending.filter((j) => j.file !== job.file),
      done: hash in done ? done : { ...done, [hash]: photoId ?? "" },
      seen: { ...seen, [job.file]: job.signature },
    });
  }

  // Network trouble: try again later, waiting longer each time (up to 10 min).
  retryLater(job: Job, error: string, now = Date.now()) {
    const attempts = job.attempts + 1;
    const wait = Math.min(10 * 60_000, 15_000 * 2 ** (attempts - 1));
    this.store.set({
      pending: this.store.get().pending.map((j) => (j.file === job.file ? { ...j, attempts, nextTry: now + wait, error } : j)),
    });
  }

  // A broken file won't get better by retrying; park it for the person.
  fail(job: Job, error: string) {
    const { pending, failed } = this.store.get();
    this.store.set({ pending: pending.filter((j) => j.file !== job.file), failed: [...failed, { ...job, error }].slice(-500) });
  }

  // A photo that reached the website another way (an upload checked by
  // this Mac), so it is never sent back.
  markSent(hash: string, photoId: string) {
    this.store.set({ done: { ...this.store.get().done, [hash]: photoId } });
  }

  // The web copy was removed; a restored original may be sent again.
  unmark(hash: string) {
    const { done } = this.store.get();
    if (!(hash in done)) return;
    const next = { ...done };
    delete next[hash];
    this.store.set({ done: next });
  }

  retryFailed() {
    const { pending, failed } = this.store.get();
    this.store.set({ pending: [...pending, ...failed.map((j) => ({ ...j, attempts: 0, nextTry: 0 }))], failed: [] });
  }

  forget(file: string) {
    const { pending } = this.store.get();
    this.store.set({ pending: pending.filter((j) => j.file !== file) });
  }

  stats() {
    const { pending, failed, done } = this.store.get();
    return { pending: pending.length, failed: failed.length, done: Object.keys(done).length, lastError: failed.at(-1)?.error ?? pending.find((j) => j.error)?.error ?? null };
  }
}
