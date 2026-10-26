import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
    renameSync(tmp, this.file);
  }
}
