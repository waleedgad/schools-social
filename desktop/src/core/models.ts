import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AURA_FILE, AURA_URL } from "./faces";

// AuraFace is too big to ship inside the app (about 250 MB), so it is
// downloaded once, the first time the app runs, into the app's own folder.
// Until it is here the older recogniser keeps working.

export type ModelState = { state: "missing" | "downloading" | "ready" | "failed"; done: number; total: number; error?: string };

export class AuraDownload {
  status: ModelState = { state: "missing", done: 0, total: 0 };
  private running: Promise<void> | null = null;

  constructor(private dir: string, private onChange: () => void) {
    if (this.ready()) this.status = { state: "ready", done: 1, total: 1 };
  }

  get file() {
    return path.join(this.dir, AURA_FILE);
  }

  ready() {
    try {
      return existsSync(this.file) && statSync(this.file).size > 100_000_000;
    } catch {
      return false;
    }
  }

  start(check?: (file: string) => Promise<void>) {
    if (this.ready() || this.running) return this.running ?? Promise.resolve();
    this.running = this.download(check).finally(() => (this.running = null));
    return this.running;
  }

  private async download(check?: (file: string) => Promise<void>) {
    const part = `${this.file}.part`;
    try {
      await mkdir(this.dir, { recursive: true });
      this.status = { state: "downloading", done: 0, total: 0 };
      this.onChange();
      const res = await fetch(AURA_URL, { redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
      const total = Number(res.headers.get("content-length") ?? 0);
      this.status.total = total;
      let last = 0;
      const body = Readable.fromWeb(res.body as never);
      body.on("data", (c: Buffer) => {
        this.status.done += c.length;
        if (this.status.done - last > 5_000_000) {
          last = this.status.done;
          this.onChange();
        }
      });
      await pipeline(body, createWriteStream(part));
      if (total && statSync(part).size !== total) throw new Error("download cut short");
      // The model must open before it replaces the old recogniser.
      if (check) await check(part);
      await rename(part, this.file);
      this.status = { state: "ready", done: total, total };
    } catch (e) {
      await rm(part, { force: true });
      this.status = { state: "failed", done: 0, total: 0, error: e instanceof Error ? e.message : String(e) };
    }
    this.onChange();
  }
}
