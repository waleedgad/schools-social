import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, rename, rm, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app, dialog, shell } from "electron";
import { freeName, listFiles } from "../core/engine";
import { bursts, calendarName, copyVerified, day, hashFile, junkReason, likelyClass, linkKind, lookAt, oneDriveShareId, parseDriveFolder, readSource, splitByGaps, type CalendarItem, type SourceFile } from "../core/importer";
import { eventFolder, guessEvent, isLibraryFile, safeName } from "../core/library";
import { marks, q, type Api, type Ctx } from "./ctx";

const run$ = promisify(execFile);

// Imports: one "Choose folders" button (one or many), cards and iPhones that
// open the Import tab by themselves, a preview grid where shots can be
// unticked, junk shots left out, events split by time gaps and named from
// the school calendar, a camera clock fix, safe copies that are checked byte
// by byte, then eject and (if asked) erase. Imports run in the background,
// one after another, and carry on after sleep or an unplugged card.

export const DROP = "Drop here";

type ScanFile = SourceFile & { n: number; thumb: string; junk: string | null; already: boolean; burst: number | null; best: boolean; quality: number };
type ScanEvent = { id: number; title: string; date: string; className: string | null; files: number[]; from: string };
type Scan = {
  id: string;
  kind: "folder" | "card" | "link" | "iphone" | "drop";
  label: string;
  volume: string | null;
  sources: string[];
  files: ScanFile[];
  events: ScanEvent[];
  cameras: { camera: string; first: number; last: number; n: number }[];
  done: number;
  total: number;
  ready: boolean;
  tooBig: { need: number; free: number } | null;
};

type JobSpec = {
  kind: Scan["kind"];
  label: string;
  volume: string | null;
  photographer: string;
  category: string;
  eject: boolean;
  erase: boolean;
  move: boolean;
  archive: boolean;
  events: { title: string; date: string; className: string | null }[];
  offsets: Record<string, number>;
  who: string | null;
  // Downloaded first (links, iPhone): removed when done.
  temp: string | null;
};

const VOLUMES = process.platform === "darwin" ? "/Volumes" : process.platform === "linux" ? `/media/${process.env.USER ?? ""}` : null;

export function importsApi(ctx: Ctx) {
  const { one, all, run } = q(ctx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = () => ctx.settings().get() as Record<string, any>;
  const scans = new Map<string, Scan>();
  let running: number | null = null;
  let cancel = new Set<number>();
  let speed = { bytes: 0, since: 0 };
  let lastPush = 0;
  const thumbs = () => ctx.data(path.join("cache", "import"));

  const calendar = (): CalendarItem[] => [...((s().calendar as CalendarItem[]) ?? []), ...((s().terms as CalendarItem[]) ?? [])];

  // ---------- Reading what is on a card or in folders ----------
  async function startScan(sources: string[], kind: Scan["kind"], label?: string, volume: string | null = null, temp: string | null = null) {
    const root = s().library as string | null;
    if (!root) throw new Error("no-library");
    sources = sources.filter((d) => !(path.resolve(d) + path.sep).startsWith(path.resolve(root) + path.sep) || kind === "drop");
    if (!sources.length) throw new Error("inside-library");
    const id = createHash("sha1").update(sources.join("|") + Date.now()).digest("hex").slice(0, 12);
    const scan: Scan = { id, kind, label: label ?? (sources.length === 1 ? path.basename(sources[0]) : `${sources.length} folders`), volume, sources, files: [], events: [], cameras: [], done: 0, total: 0, ready: false, tooBig: null };
    scans.set(id, scan);
    tempOf.set(id, temp);
    void readScan(scan).catch((e) => {
      ctx.log(`import scan: ${e}`);
      scan.ready = true;
    });
    return { id };
  }
  const tempOf = new Map<string, string | null>();

  async function readScan(scan: Scan) {
    await mkdir(thumbs(), { recursive: true });
    const perSource: { dir: string; files: string[] }[] = [];
    for (const dir of scan.sources) {
      const st = await stat(dir).catch(() => null);
      perSource.push({ dir, files: st?.isFile() ? (isLibraryFile(dir) ? [dir] : []) : await listFiles(dir) });
    }
    scan.total = perSource.reduce((n, p) => n + p.files.length, 0);
    const seen = new Set(all<{ key: string }>("select key from seen_files").map((r) => r.key));
    const known = new Set(all<{ hash: string }>("select hash from photos where hash is not null and missing = 0").map((r) => r.hash));
    let n = 0;
    for (const src of perSource) {
      const mine: ScanFile[] = [];
      for (const file of src.files) {
        const f = await readSource(file).catch(() => null);
        scan.done++;
        if (!f) continue;
        const thumb = createHash("sha1").update(f.file + f.size).digest("hex").slice(0, 16);
        const look = f.video ? null : await lookAt(f.file, path.join(thumbs(), `${thumb}.jpg`));
        const sf: ScanFile = { ...f, n: n++, thumb, junk: s().importJunk ? junkReason(look) : null, already: seen.has(f.key), burst: null, best: true, quality: look ? Math.log10(1 + look.sharpness) : 0 };
        // A card already imported from: photos seen before are left out.
        // Folders (photographers) are checked by their bytes when copying.
        mine.push(sf);
        scan.files.push(sf);
        if (Date.now() - lastPush > 600) {
          lastPush = Date.now();
          ctx.sendWin("importScan", { id: scan.id, done: scan.done, total: scan.total });
        }
      }
      // A folder whose name says what it is ("2020-10-12 Sports day") is one
      // event; a card or a camera folder is split by time gaps.
      const guess = guessEvent(path.basename(src.dir));
      const named = scan.kind === "folder" && scan.sources.length > 1 || (guess.title && !/^(dcim|\d{3}[a-z_]+|camera|photos?|images?|pictures?|download(s)?|desktop|untitled)/i.test(guess.title));
      const groups = named ? [mine] : splitByGaps(mine, Number(s().splitGap ?? 2));
      for (const g of groups) {
        if (!g.length) continue;
        const date = guess.date && named ? guess.date : day(g[0].taken);
        const title = (named ? guess.title : "") || calendarName(date, calendar()) || "";
        scan.events.push({ id: scan.events.length, title, date, className: null, files: g.map((x) => x.n), from: path.basename(src.dir) });
      }
    }
    // Photos already in the library (same bytes) are checked quickly by size
    // first, then by hash, only for files whose size matches a library photo.
    const sizes = new Set(all<{ size: number }>("select distinct size from photos where missing = 0").map((r) => r.size));
    for (const f of scan.files) {
      if (f.already || !sizes.has(f.size) || f.size > 80_000_000) continue;
      const h = await hashFile(f.file).catch(() => null);
      if (h && known.has(h)) f.already = true;
    }
    for (const g of bursts(scan.files)) {
      const best = [...g].sort((a, b) => b.quality - a.quality)[0];
      for (const f of g) {
        f.burst = best.n;
        f.best = f === best;
      }
    }
    const cams = new Map<string, Scan["cameras"][number]>();
    for (const f of scan.files) {
      const c = cams.get(f.camera) ?? { camera: f.camera, first: f.taken, last: f.taken, n: 0 };
      c.first = Math.min(c.first, f.taken);
      c.last = Math.max(c.last, f.taken);
      c.n++;
      cams.set(f.camera, c);
    }
    scan.cameras = [...cams.values()];
    scan.tooBig = await spaceCheck(scan.files.filter((f) => !f.already && !f.junk).reduce((a, f) => a + f.size, 0));
    scan.ready = true;
    ctx.sendWin("importScan", { id: scan.id, done: scan.total, total: scan.total, ready: true });
  }

  async function spaceCheck(need: number) {
    const root = s().library as string | null;
    if (!root) return null;
    const fs = await statfs(root).catch(() => null);
    if (!fs) return null;
    const free = fs.bavail * fs.bsize;
    // Keep 2 GB spare for the computer itself.
    return need + 2e9 > free ? { need, free } : null;
  }

  function scanView(id: string) {
    const scan = scans.get(id);
    if (!scan) return null;
    return {
      ...scan,
      files: scan.files.map((f) => ({ n: f.n, name: path.basename(f.file), thumb: f.thumb, taken: f.taken, camera: f.camera, size: f.size, raw: f.raw, video: f.video, junk: f.junk, already: f.already, burst: f.burst, best: f.best })),
    };
  }

  // ---------- Background imports ----------
  function queueImport(o: {
    scanId: string;
    events: { title: string; date: string; className: string | null; files: number[] }[];
    photographer?: string;
    category?: string;
    offsets?: Record<string, number>;
    eject?: boolean;
    erase?: boolean;
    archive?: boolean;
  }) {
    const scan = scans.get(o.scanId);
    if (!scan) throw new Error("scan-gone");
    const root = s().library as string;
    const events = o.events.filter((e) => e.files.length && e.title.trim().length >= 2);
    if (!events.length) throw new Error("no-events");
    const offsets = o.offsets ?? {};
    // From a folder on the library's own drive a self-filing library moves the
    // photos instead of copying them (the folder isn't a card).
    const sameDrive = scan.kind === "folder" && s().selfFiling && scan.sources.every((d) => existsSync(d) && statSync(d).dev === statSync(root).dev);
    const spec: JobSpec = {
      kind: scan.kind,
      label: scan.label,
      volume: scan.volume,
      photographer: (o.photographer ?? s().importPhotographer ?? "").trim(),
      category: (o.category ?? s().importCategory ?? "").trim(),
      eject: !!(o.eject ?? s().importEject) && !!scan.volume,
      erase: !!o.erase && !!scan.volume,
      move: sameDrive || scan.kind === "drop",
      archive: !!o.archive,
      events: events.map((e) => ({ title: e.title.trim(), date: e.date, className: e.className })),
      offsets,
      who: (s().email as string) ?? null,
      temp: tempOf.get(scan.id) ?? null,
    };
    const imp = run("insert into imports (at, who, source, photographer, category, folders) values (?, ?, ?, ?, ?, '[]')", Date.now(), spec.who, scan.label, spec.photographer || null, spec.category || null);
    const importId = Number(imp.lastInsertRowid);
    const job = run("insert into import_jobs (import_id, state, spec, created) values (?, 'waiting', ?, ?)", importId, JSON.stringify(spec), Date.now());
    const jobId = Number(job.lastInsertRowid);
    let n = 0, bytes = 0;
    const raw = s().rawFolders !== false;
    events.forEach((e) => {
      for (const i of e.files) {
        const f = scan.files[i];
        if (!f) continue;
        const shift = offsets[f.camera] ?? 0;
        const taken = new Date(e.date ? Date.parse(`${e.date}T12:00:00`) : f.taken + shift);
        let dir = eventFolder(root, taken, e.title.trim());
        if (e.className) dir = path.join(dir, safeName(e.className));
        if (raw && f.raw) dir = path.join(dir, "RAW");
        run("insert into job_files (job_id, n, src, size, dest_dir) values (?, ?, ?, ?, ?)", jobId, n++, f.file, f.size, dir);
        bytes += f.size;
      }
    });
    run("update import_jobs set total = ?, bytes_total = ? where id = ?", n, bytes, jobId);
    // What wasn't ticked goes into the report of skipped files.
    const chosen = new Set(events.flatMap((e) => e.files));
    const left = scan.files.filter((f) => !chosen.has(f.n)).map((f) => ({ file: f.file, why: f.already ? "already" : f.junk ? `junk-${f.junk}` : "unticked" }));
    run("update imports set report = ? where id = ?", JSON.stringify(left), importId);
    scans.delete(scan.id);
    void tick();
    return { job: jobId, importId };
  }

  async function tick() {
    if (running) return;
    const next = all<{ id: number; spec: string }>("select id, spec from import_jobs where state in ('waiting', 'running') order by id");
    for (const j of next) {
      // A card that isn't plugged in: wait for it.
      const src = one<{ src: string }>("select src from job_files where job_id = ? and state = 'todo' limit 1", j.id);
      if (src && !existsSync(src.src)) {
        run("update import_jobs set state = 'waiting' where id = ?", j.id);
        continue;
      }
      running = j.id;
      try {
        await runJob(j.id, JSON.parse(j.spec) as JobSpec);
      } catch (e) {
        ctx.log(`import ${j.id}: ${e}`);
        run("update import_jobs set state = 'waiting', error = ? where id = ?", String(e instanceof Error ? e.message : e), j.id);
      } finally {
        running = null;
      }
      return void tick();
    }
  }

  async function runJob(jobId: number, spec: JobSpec) {
    const job = one<{ import_id: number }>("select import_id from import_jobs where id = ?", jobId)!;
    run("update import_jobs set state = 'running', error = null where id = ?", jobId);
    const root = s().library as string;
    const known = new Set(all<{ hash: string }>("select hash from photos where hash is not null and missing = 0").map((r) => r.hash));
    const skipDup = s().importSkipDup !== false;
    speed = { bytes: 0, since: Date.now() };
    const files = all<{ n: number; src: string; size: number; dest_dir: string }>("select n, src, size, dest_dir from job_files where job_id = ? and state = 'todo' order by n", jobId);
    for (const f of files) {
      if (cancel.has(jobId)) break;
      if (!existsSync(f.src)) {
        // The card was unplugged: stop here and carry on when it's back.
        run("update import_jobs set state = 'waiting' where id = ?", jobId);
        push(true);
        return;
      }
      let state = "done", dest: string | null = null, reason: string | null = null;
      try {
        const hash = await hashFile(f.src);
        if (skipDup && known.has(hash)) {
          state = "dup";
          reason = "already";
        } else {
          await mkdir(f.dest_dir, { recursive: true });
          dest = await freeName(path.join(f.dest_dir, path.basename(f.src)));
          const info = await readSource(f.src).catch(() => null);
          run(
            "insert or replace into import_files (path, import_id, offset_ms, photographer, category) values (?, ?, ?, ?, ?)",
            dest, job.import_id, info ? (spec.offsets[info.camera] ?? 0) : 0, spec.photographer || null, spec.category || null,
          );
          if (spec.move) {
            await rename(f.src, dest).catch(async () => {
              await copyVerified(f.src, dest!, hash);
              await unlink(f.src);
            });
          } else await copyVerified(f.src, dest, hash);
          known.add(hash);
          if (info) run("insert or ignore into seen_files (key, at) values (?, ?)", info.key, Date.now());
        }
      } catch (e) {
        state = "failed";
        reason = e instanceof Error ? e.message : String(e);
        if (dest) run("delete from import_files where path = ?", dest);
      }
      run("update job_files set state = ?, dest = ?, reason = ? where job_id = ? and n = ?", state, dest, reason, jobId, f.n);
      run("update import_jobs set done = done + 1, bytes_done = bytes_done + ? where id = ?", f.size, jobId);
      speed.bytes += f.size;
      push();
    }
    if (cancel.has(jobId)) {
      cancel.delete(jobId);
      run("update import_jobs set state = 'cancelled' where id = ?", jobId);
      return finish(jobId, spec, true);
    }
    return finish(jobId, spec, false);
  }

  async function finish(jobId: number, spec: JobSpec, cancelled: boolean) {
    const job = one<{ import_id: number }>("select import_id from import_jobs where id = ?", jobId)!;
    const rows = all<{ state: string; src: string; dest: string | null; dest_dir: string; reason: string | null }>("select state, src, dest, dest_dir, reason from job_files where job_id = ?", jobId);
    const copied = rows.filter((r) => r.state === "done").length;
    const folders = [...new Set(rows.filter((r) => r.state === "done").map((r) => r.dest_dir.replace(/[/\\]RAW$/, "")))];
    const imp = one<{ report: string | null }>("select report from imports where id = ?", job.import_id);
    const report = [...(JSON.parse(imp?.report ?? "[]") as unknown[]), ...rows.filter((r) => r.state !== "done").map((r) => ({ file: r.src, why: r.state === "dup" ? "already" : r.state === "todo" ? "cancelled" : `failed: ${r.reason}` }))];
    run("update imports set copied = ?, skipped = ?, folders = ?, report = ? where id = ?", copied, report.length, JSON.stringify(folders), JSON.stringify(report), job.import_id);
    if (spec.archive) for (const f of folders) run("insert into folders (path, archive) values (?, 1) on conflict (path) do update set archive = 1", f);
    if (!cancelled) run("update import_jobs set state = 'done' where id = ?", jobId);
    // Erase only what is safely in the library (checked copies and photos
    // that were there already), never anything else on the card.
    let erased = 0;
    if (spec.erase && !cancelled)
      for (const r of rows.filter((r) => r.state === "done" || r.state === "dup")) {
        await unlink(r.src).then(() => erased++).catch(() => {});
      }
    if (spec.temp) await rm(spec.temp, { recursive: true, force: true }).catch(() => {});
    const othersOnCard = spec.volume ? all("select id from import_jobs where state in ('waiting', 'running') and id != ? and spec like ?", jobId, `%${JSON.stringify(spec.volume).slice(1, -1)}%`).length : 0;
    let ejected = false;
    if (spec.eject && spec.volume && !othersOnCard) ejected = await eject(spec.volume);
    const title = spec.events.length === 1 ? spec.events[0].title : `${spec.events.length} events`;
    ctx.remember("import", `${copied}:${title}`, { kind: "import", id: job.import_id });
    ctx.message(`imported:${copied}:${title}`);
    if (s().teamImportAlert && copied) ctx.appApi("notifyImport", { count: copied, title, photographer: spec.photographer || null }).catch(() => {});
    ctx.sendWin("importDone", { job: jobId, importId: job.import_id, copied, erased, ejected, safeToRemove: !!spec.volume && !othersOnCard });
    push(true);
  }

  async function eject(volume: string) {
    try {
      if (process.platform === "darwin") await run$("diskutil", ["eject", volume]);
      else if (process.platform === "win32") {
        const drive = volume.slice(0, 2);
        await run$("powershell", ["-NoProfile", "-Command", `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${drive}').InvokeVerb('Eject')`]);
      } else await run$("udisksctl", ["unmount", "-b", volume]).catch(() => run$("umount", [volume]));
      return true;
    } catch (e) {
      ctx.log(`eject ${volume}: ${e}`);
      return false;
    }
  }

  function push(now = false) {
    if (!now && Date.now() - lastPush < 700) return;
    lastPush = Date.now();
    ctx.push("status");
    if (now) ctx.push("photos");
  }

  function jobs() {
    return all<{ id: number; import_id: number; state: string; spec: string; done: number; total: number; bytes_done: number; bytes_total: number; error: string | null }>(
      "select * from import_jobs where state in ('waiting', 'running') or (state in ('done', 'cancelled') and created > ?) order by id",
      Date.now() - 2 * 3600_000,
    ).map((j) => {
      const spec = JSON.parse(j.spec) as JobSpec;
      const rate = j.id === running && Date.now() - speed.since > 3000 ? speed.bytes / ((Date.now() - speed.since) / 1000) : 0;
      return {
        id: j.id,
        importId: j.import_id,
        state: j.state === "waiting" && j.error ? "problem" : j.state,
        title: spec.events.length === 1 ? spec.events[0].title : `${spec.label} · ${spec.events.length}`,
        done: j.done,
        total: j.total,
        // Seconds left from the copying speed so far.
        left: rate > 0 ? Math.round((j.bytes_total - j.bytes_done) / rate) : null,
        waitingForCard: j.state === "waiting" && !!spec.volume && !existsSync(spec.volume),
        error: j.error,
      };
    });
  }

  // ---------- Cards and iPhones ----------
  async function volumes() {
    const out: { name: string; path: string; volume: string }[] = [];
    if (process.platform === "win32") {
      for (const l of "DEFGHIJKLMNOPQRSTUVWXYZ") {
        const dcim = `${l}:\\DCIM`;
        if (existsSync(dcim)) out.push({ name: `${l}:`, path: dcim, volume: `${l}:\\` });
      }
      return out;
    }
    if (!VOLUMES) return out;
    for (const v of await readdir(VOLUMES).catch(() => [] as string[])) {
      const dcim = path.join(VOLUMES, v, "DCIM");
      if (existsSync(dcim)) out.push({ name: v, path: dcim, volume: path.join(VOLUMES, v) });
    }
    return out;
  }

  let known = new Set<string>();
  let phone = false;
  let watcher: FSWatcher | null = null;
  const timers: NodeJS.Timeout[] = [];
  async function checkDevices(first = false) {
    const now = await volumes();
    for (const v of now) {
      if (known.has(v.path)) continue;
      known.add(v.path);
      if (!first) {
        // A card that an import is waiting for: carry on by itself.
        void tick();
        if (s().importAutoOpen !== false && !all("select id from import_jobs where state = 'waiting'").length) {
          ctx.win()?.show();
          ctx.sendWin("importDevice", { kind: "card", name: v.name, path: v.path, volume: v.volume });
        }
      }
    }
    known = new Set([...known].filter((p) => now.some((v) => v.path === p)));
    const has = await iphonePlugged();
    if (has && !phone && !first && s().importAutoOpen !== false) {
      ctx.win()?.show();
      ctx.sendWin("importDevice", { kind: "iphone", name: "iPhone" });
    }
    phone = has;
  }

  async function iphonePlugged() {
    try {
      if (process.platform === "darwin") {
        const { stdout } = await run$("ioreg", ["-p", "IOUSB", "-w0"], { maxBuffer: 4e6 });
        return /iPhone|iPad/.test(stdout);
      }
      if (process.platform === "win32") {
        const { stdout } = await run$("powershell", ["-NoProfile", "-Command", "(New-Object -ComObject Shell.Application).Namespace(17).Items() | % { $_.Name }"]);
        return /iPhone|iPad|Apple/i.test(stdout);
      }
    } catch {
      // no USB list
    }
    return false;
  }

  function startWatching() {
    void checkDevices(true);
    if (VOLUMES && existsSync(VOLUMES)) {
      try {
        watcher = watch(VOLUMES, () => setTimeout(() => void checkDevices(), 1500));
      } catch {
        // polled below
      }
    }
    timers.push(setInterval(() => void checkDevices(), process.platform === "win32" ? 8000 : 6000));
    timers.push(setInterval(() => void tick(), 60_000));
    timers.push(setInterval(() => void dropTick(), 20_000));
    // Anything left from last time (sleep, quit, unplugged card) carries on.
    setTimeout(() => void tick(), 4000);
  }
  function stopWatching() {
    watcher?.close();
    timers.forEach(clearInterval);
  }

  // Photos straight off an iPhone, without exporting them first. On a Mac a
  // small helper uses Apple's Image Capture; on Windows the phone shows up
  // under "This PC" and is copied from there.
  const helperSource = () => (app.isPackaged ? path.join(process.resourcesPath, "helpers", "iphone-import.swift") : path.join(__dirname, "..", "..", "helpers", "iphone-import.swift"));
  const helperBin = () => {
    const bundled = app.isPackaged ? path.join(process.resourcesPath, "helpers", "iphone-import") : path.join(__dirname, "..", "..", "helpers", "iphone-import");
    return existsSync(bundled) ? bundled : ctx.data(path.join("helpers", "iphone-import"));
  };
  async function iphoneHelper() {
    if (existsSync(helperBin())) return helperBin();
    // Built on this Mac the first time, with Apple's own free developer tools.
    try {
      await mkdir(path.dirname(ctx.data(path.join("helpers", "x"))), { recursive: true });
      await run$("xcrun", ["swiftc", "-O", helperSource(), "-o", ctx.data(path.join("helpers", "iphone-import"))], { timeout: 180_000 });
      return ctx.data(path.join("helpers", "iphone-import"));
    } catch (e) {
      ctx.log(`iphone helper: ${e}`);
      return null;
    }
  }

  async function iphoneImport() {
    const temp = ctx.data(path.join("cache", "iphone", String(Date.now())));
    await mkdir(temp, { recursive: true });
    const skip = ctx.data(path.join("cache", "iphone-seen.txt"));
    await writeFile(skip, all<{ key: string }>("select key from seen_files").map((r) => r.key).join("\n"));
    if (process.platform === "darwin") {
      const bin = await iphoneHelper();
      if (!bin) {
        // Apple's tools aren't on this Mac yet: macOS offers to install them.
        execFile("xcode-select", ["--install"], () => {});
        return { needTools: true };
      }
      await new Promise<void>((resolve, reject) => {
        const child = execFile(bin, ["download", temp, skip], { maxBuffer: 1e7, timeout: 6 * 3600_000 }, (err) => (err ? reject(err) : resolve()));
        child.stdout?.on("data", (d: Buffer) => {
          const m = /(\d+)\/(\d+)/.exec(d.toString().split("\n").filter(Boolean).at(-1) ?? "");
          if (m) ctx.sendWin("importScan", { id: "iphone", done: Number(m[1]), total: Number(m[2]), phase: "download" });
        });
      });
    } else if (process.platform === "win32") {
      // Phone > Internal Storage > DCIM, copied folder by folder.
      const ps = `$sh = New-Object -ComObject Shell.Application
$pc = $sh.Namespace(17)
$phone = $pc.Items() | ? { $_.Name -match 'iPhone|iPad|Apple' } | select -First 1
if (-not $phone) { exit 3 }
$store = $phone.GetFolder.Items() | select -First 1
$dcim = $store.GetFolder.Items() | ? { $_.Name -eq 'DCIM' } | select -First 1
$dest = $sh.Namespace('${temp.replace(/'/g, "''")}')
foreach ($f in $dcim.GetFolder.Items()) { $dest.CopyHere($f, 4 + 16 + 1024); Write-Output $f.Name }`;
      await run$("powershell", ["-NoProfile", "-Command", ps], { timeout: 6 * 3600_000, maxBuffer: 1e7 });
    } else throw new Error("not-supported");
    return startScan([temp], "iphone", "iPhone", null, temp);
  }

  // ---------- Shared links ----------
  async function importLink(url: string) {
    const k = linkKind(url);
    if (!k) throw new Error("bad-link");
    const temp = ctx.data(path.join("cache", "links", String(Date.now())));
    await mkdir(temp, { recursive: true });
    const items: { name: string; url: string }[] = [];
    if (k.kind === "gdrive-folder") {
      const walk = async (id: string, depth: number) => {
        const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`);
        if (!res.ok) throw new Error("link-not-public");
        for (const e of parseDriveFolder(await res.text())) {
          if (e.folder) {
            if (depth < 3) await walk(e.id, depth + 1);
          } else items.push({ name: e.name, url: `https://drive.usercontent.google.com/download?id=${e.id}&export=download&confirm=t` });
        }
      };
      await walk(k.id, 0);
    } else if (k.kind === "gdrive-file") items.push({ name: "", url: `https://drive.usercontent.google.com/download?id=${k.id}&export=download&confirm=t` });
    else {
      const res = await fetch(`https://api.onedrive.com/v1.0/shares/${oneDriveShareId(k.id)}/driveItem?$expand=children`);
      if (!res.ok) throw new Error("link-not-public");
      const item = (await res.json()) as { name: string; folder?: unknown; children?: { name: string; file?: unknown; "@content.downloadUrl"?: string }[]; "@content.downloadUrl"?: string };
      if (item.folder) for (const c of item.children ?? []) if (c.file && c["@content.downloadUrl"]) items.push({ name: c.name, url: c["@content.downloadUrl"] });
      if (!item.folder && item["@content.downloadUrl"]) items.push({ name: item.name, url: item["@content.downloadUrl"] });
    }
    let done = 0;
    for (const it of items) {
      if (it.name && !isLibraryFile(it.name)) continue;
      const res = await fetch(it.url).catch(() => null);
      done++;
      ctx.sendWin("importScan", { id: "link", done, total: items.length, phase: "download" });
      if (!res?.ok) continue;
      const name = it.name || /filename="?([^";]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1] || `photo-${done}.jpg`;
      if (!isLibraryFile(name)) continue;
      await writeFile(await freeName(path.join(temp, safeName(name))), Buffer.from(await res.arrayBuffer()));
    }
    if (!(await readdir(temp)).length) throw new Error("link-empty");
    return startScan([temp], "link", k.kind === "onedrive" ? "OneDrive" : "Google Drive", null, temp);
  }

  // ---------- The "Drop here" folder ----------
  // Anything put into "Drop here" in the library sorts itself into the
  // right year, term and event after a short wait.
  async function dropTick() {
    const root = s().library as string | null;
    if (!root || running || all("select id from import_jobs where state in ('waiting', 'running')").length) return;
    const dir = path.join(root, DROP);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true }).catch(() => {});
    const files = await listFiles(dir).catch(() => [] as string[]);
    // Only files that finished copying (unchanged for a minute).
    const settled = [];
    for (const f of files) {
      const st = await stat(f).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 60_000) settled.push(f);
    }
    if (!settled.length) return;
    const list = await Promise.all(settled.map((f) => readSource(f).catch(() => null)));
    const ok = list.filter(Boolean) as SourceFile[];
    const scan: Scan = { id: `drop${Date.now()}`, kind: "drop", label: DROP, volume: null, sources: [dir], files: ok.map((f, n) => ({ ...f, n, thumb: "", junk: null, already: false, burst: null, best: true, quality: 0 })), events: [], cameras: [], done: ok.length, total: ok.length, ready: true, tooBig: null };
    scans.set(scan.id, scan);
    const groups = splitByGaps(scan.files, Number(s().splitGap ?? 2));
    queueImport({
      scanId: scan.id,
      events: groups.map((g) => {
        const date = day(g[0].taken);
        return { title: calendarName(date, calendar()) || "Photos", date, className: null, files: g.map((f) => f.n) };
      }),
      eject: false,
    });
  }

  // ---------- After an import ----------
  function summary(importId: number) {
    const imp = one<{ id: number; at: number; source: string; copied: number; skipped: number; folders: string; report: string | null; photographer: string | null; category: string | null; undone: number }>("select * from imports where id = ?", importId);
    if (!imp) return null;
    const photos = all<{ id: number }>("select id from photos where import_id = ?", importId).map((r) => r.id);
    const classes = photos.length
      ? all<{ class_name: string | null }>(
          `select s.class_name from faces f join students s on s.id = f.student_id where f.photo_id in (${marks(photos.length)}) and f.status in ('confirmed', 'manual', 'auto') and s.kind = 'student'`,
          ...photos,
        ).map((r) => r.class_name)
      : [];
    const unnamed = photos.length ? one<{ n: number }>(`select count(*) n from faces where photo_id in (${marks(photos.length)}) and status in ('unknown', 'suggested')`, ...photos)?.n ?? 0 : 0;
    const noClass = photos.length ? one<{ n: number }>(`select count(*) n from photos where id in (${marks(photos.length)}) and class_name is null`, ...photos)?.n ?? 0 : 0;
    const events = photos.length ? all(`select event_key key, event_title title, event_date date, count(*) n from photos where id in (${marks(photos.length)}) and event_key is not null group by event_key`, ...photos) : [];
    return {
      ...imp,
      folders: JSON.parse(imp.folders) as string[],
      report: JSON.parse(imp.report ?? "[]") as { file: string; why: string }[],
      photos: photos.length,
      unnamed,
      events,
      classSuggestion: noClass ? likelyClass(classes) : null,
    };
  }

  async function applyClass(importId: number, className: string) {
    const rows = all<{ id: number; event_title: string; event_date: string }>("select id, event_title, event_date from photos where import_id = ? and class_name is null and event_key is not null", importId);
    const groups = new Map<string, { ids: number[]; title: string; date: string }>();
    for (const r of rows) {
      const k = `${r.event_title}|${r.event_date}`;
      const g = groups.get(k) ?? { ids: [], title: r.event_title, date: r.event_date };
      g.ids.push(r.id);
      groups.set(k, g);
    }
    const undo = [];
    for (const g of groups.values()) undo.push(...((await ctx.engine()?.moveTo(g.ids, { title: g.title, date: g.date, className })) ?? []));
    ctx.remember("move", `${rows.length}:${className}`, { kind: "move", items: undo });
    ctx.push("photos");
    return rows.length;
  }

  async function saveReport(importId: number) {
    const imp = summary(importId);
    if (!imp) return null;
    const r = await dialog.showSaveDialog(ctx.win()!, { defaultPath: `Import ${new Date(imp.at).toISOString().slice(0, 10)} skipped.csv` });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, "file,why\n" + imp.report.map((x) => `"${x.file.replace(/"/g, '""')}",${x.why}`).join("\n"));
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  }

  const api: Api = {
    importChoose: async (dirs?: string[]) => {
      if (!dirs?.length) {
        const r = await dialog.showOpenDialog(ctx.win()!, { title: "Folders to import: a card, a phone folder or a photographer's folders (choose several with ⌘ or ⇧)", properties: ["openDirectory", "multiSelections"] });
        if (r.canceled || !r.filePaths.length) return null;
        dirs = r.filePaths;
      }
      const vols = await volumes();
      const card = dirs.length === 1 ? vols.find((v) => (dirs![0] + path.sep).startsWith(v.volume + path.sep) || dirs![0] === v.volume) : undefined;
      return startScan(dirs, card ? "card" : "folder", card?.name, card?.volume ?? null);
    },
    importCard: async (dcim: string) => {
      const v = (await volumes()).find((x) => x.path === dcim);
      return startScan([dcim], "card", v?.name ?? path.basename(path.dirname(dcim)), v?.volume ?? null);
    },
    importScan: (id: string) => scanView(id),
    importStart: (o: Parameters<typeof queueImport>[0]) => queueImport(o),
    importCancel: (jobId: number) => {
      cancel.add(jobId);
      if (running !== jobId) {
        run("update import_jobs set state = 'cancelled' where id = ? and state = 'waiting'", jobId);
        cancel.delete(jobId);
      }
      push(true);
    },
    importRetry: (jobId: number) => {
      run("update import_jobs set error = null, state = 'waiting' where id = ?", jobId);
      void tick();
    },
    importJobs: () => jobs(),
    importSummary: (importId: number) => summary(importId),
    importApplyClass: (importId: number, className: string) => applyClass(importId, className),
    importSaveReport: (importId: number) => saveReport(importId),
    importLink: (url: string) => importLink(url),
    importIphone: () => iphoneImport(),
    volumes: () => volumes(),
    ejectCard: (volume: string) => eject(volume),
    importSpace: async () => {
      const root = s().library as string | null;
      const fs = root ? await statfs(root).catch(() => null) : null;
      return fs ? { free: fs.bavail * fs.bsize, total: fs.blocks * fs.bsize } : null;
    },
    revealFolder: (dir: string) => {
      if (existsSync(dir)) shell.openPath(dir);
    },
    dropFolder: async () => {
      const root = s().library as string | null;
      if (!root) return null;
      const dir = path.join(root, DROP);
      await mkdir(dir, { recursive: true });
      shell.openPath(dir);
      return dir;
    },
  };
  return { api, startWatching, stopWatching, jobs };
}
