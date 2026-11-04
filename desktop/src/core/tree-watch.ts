import { realpathSync, watch as fsWatch, type Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { watch as chokidar } from "chokidar";

// Watches a whole folder tree (the library, a watched cloud folder) for new,
// changed and removed photos.
//
// On Mac and Windows one watch covers the whole tree: the system's own
// change feed (FSEvents, ReadDirectoryChanges) via fs.watch recursive.
// chokidar instead opens one watch per file, which on a Mac means one open
// file per photo: a library of 20,000 photos kept the app from opening
// (found by the huge-library robot test on a real Mac) and a bigger one runs
// out of open files. Linux keeps chokidar, which uses cheap inotify there.

export type TreeWatcher = {
  on(event: "add" | "change", fn: (file: string, stats: Stats) => void): TreeWatcher;
  on(event: "unlink" | "unlinkDir", fn: (file: string) => void): TreeWatcher;
  on(event: "error", fn: (e: unknown) => void): TreeWatcher;
  close(): Promise<void>;
};

export type TreeWatchOptions = {
  depth: number;
  // A file counts once its size has stayed the same this long.
  settle: number;
  // Like chokidar's: skip a path (stats are given for files and folders).
  ignored?: (file: string, stats?: Stats) => boolean;
  native?: boolean;
};

type Fn = (...a: never[]) => void;

export function watchTree(root: string, o: TreeWatchOptions): TreeWatcher {
  // HUB_TREE_WATCH=native runs the Mac/Windows way on Linux, for the robot tests.
  const native = o.native ?? (process.env.HUB_TREE_WATCH === "native" || process.platform === "darwin" || process.platform === "win32");
  if (!native) {
    return chokidar(root, {
      ignoreInitial: true,
      alwaysStat: true,
      depth: o.depth,
      awaitWriteFinish: { stabilityThreshold: o.settle, pollInterval: 250 },
      ignored: o.ignored,
    }) as unknown as TreeWatcher;
  }

  const handlers: Record<string, Fn[]> = {};
  const emit = (event: string, ...args: unknown[]) => (handlers[event] ?? []).forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
  const known = new Map<string, number>(); // file -> size when last told
  const pending = new Map<string, NodeJS.Timeout>();
  let closed = false;

  const tooDeep = (full: string) => path.relative(root, full).split(path.sep).length - 1 > o.depth;
  const skip = (full: string, stats?: Stats) => {
    if (tooDeep(full)) return true;
    // Every folder on the way counts too (a hidden or skipped folder hides what is inside).
    const parts = path.relative(root, full).split(path.sep);
    for (let i = 1; i < parts.length; i++) if (o.ignored?.(path.join(root, ...parts.slice(0, i)))) return true;
    return !!o.ignored?.(full, stats);
  };

  // Waits until a file stops growing (a camera card or a cloud drive still
  // copying it), then reports it once.
  const settle = (full: string, last = -1) => {
    clearTimeout(pending.get(full));
    pending.set(
      full,
      setTimeout(async () => {
        pending.delete(full);
        if (closed) return;
        let s: Stats;
        try {
          s = await stat(full);
        } catch {
          known.delete(full);
          if (!skip(full)) {
            emit("unlink", full);
            emit("unlinkDir", full);
          }
          return;
        }
        if (s.isDirectory()) return void addTree(full);
        if (!s.isFile() || skip(full, s)) return;
        if (s.size !== last) return settle(full, s.size);
        const was = known.get(full);
        known.set(full, s.size);
        emit(was === undefined ? "add" : "change", full, s);
      }, last === -1 ? o.settle : 250),
    );
  };

  // A folder moved or copied in arrives as one event: look inside it.
  const addTree = async (dir: string) => {
    if (closed) return;
    let dirStats: Stats;
    try {
      dirStats = await stat(dir);
    } catch {
      return;
    }
    if (skip(dir, dirStats)) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await addTree(full);
      else if (e.isFile()) settle(full);
    }
  };

  // The system reports changes under the folder's real location (on a Mac the
  // temp folder /var/... is really /private/var/..., and a library can be a
  // link), so watch that and give paths back under the folder as the app
  // knows it.
  let real = root;
  try {
    real = realpathSync(root);
  } catch {
    // watched as given
  }
  const back = (name: string) => {
    const full = path.isAbsolute(name) ? name : path.join(real, name);
    const rel = path.relative(real, full);
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : path.join(root, rel);
  };
  let w: ReturnType<typeof fsWatch> | null = null;
  try {
    w = fsWatch(real, { recursive: true, persistent: false }, (_type, name) => {
      if (!name || closed) return;
      const full = back(name.toString());
      if (full) settle(full);
    });
    w.on("error", (e) => emit("error", e));
  } catch (e) {
    setTimeout(() => emit("error", e), 0);
  }

  const api: TreeWatcher = {
    on(event: string, fn: Fn) {
      (handlers[event] ??= []).push(fn);
      return api;
    },
    async close() {
      closed = true;
      w?.close();
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    },
  } as TreeWatcher;
  return api;
}
