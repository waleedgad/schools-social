import fs, { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// A small JSON file that survives restarts, written atomically so a power
// cut can't leave half a file.
export class JsonStore<T extends object> {
  private data: T;

  constructor(private file: string, defaults: T) {
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      this.data = { ...defaults, ...JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      this.data = defaults;
    }
  }

  get(): T {
    return this.data;
  }

  set(patch: Partial<T>) {
    this.data = { ...this.data, ...patch };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    // Windows: the antivirus or search indexer can hold the file open for a
    // moment, and the swap then fails with EPERM/EBUSY. That threw from deep
    // inside sending (the queue) or saving settings. Tried again briefly; in
    // the end written in place, so the change is never lost.
    for (let i = 1; ; i++) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? "";
        if (!["EPERM", "EBUSY", "EACCES"].includes(code)) throw e;
        if (i >= 6) {
          writeFileSync(this.file, JSON.stringify(this.data));
          return;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * i);
      }
    }
  }
}
