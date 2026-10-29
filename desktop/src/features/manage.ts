import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { app, dialog, shell } from "electron";
import { tx } from "../core/db";
import { freeName, moveFile } from "../core/engine";
import { guessEvent, schoolYear, setTermDates, type TermDates } from "../core/library";
import { readSheet } from "../core/students";
import { marks, q, type Api, type Ctx } from "./ctx";

// Folders, the archive drive for old years, the app's own Bin (30 days,
// everything can be put back), the school calendar's term dates, import
// history, problem reports and updates.

const DAY = 86400_000;

export function manageApi(ctx: Ctx): Api {
  const { one, all, run } = q(ctx);
  const lib = () => ctx.settings().get().library as string | null;

  // ---------- Bin ----------
  // Photos go into "_Bin" inside the library ("_" folders are never read),
  // so nothing leaves the drive for 30 days and every photo can come back.
  async function binPhotos(ids: number[], why = "bin") {
    const root = lib();
    const rows = all<{ id: number; path: string; hash: string | null; remote_id: string | null; missing: number }>(`select id, path, hash, remote_id, missing from photos where id in (${marks(ids.length)})`, ...ids);
    const day = new Date().toISOString().slice(0, 10);
    let n = 0;
    for (const r of rows) {
      let binned: string | null = null;
      if (root && !r.missing && existsSync(r.path)) {
        const dir = path.join(root, "_Bin", day);
        await mkdir(dir, { recursive: true });
        binned = await freeName(path.join(dir, `${r.id}-${path.basename(r.path)}`));
        await moveFile(r.path, binned).catch(async () => {
          binned = null;
          await shell.trashItem(r.path).catch(() => {});
        });
      }
      run("insert or replace into bin (photo_id, from_path, bin_path, at, why) values (?, ?, ?, ?, ?)", r.id, r.path, binned, Date.now(), why);
      run("update photos set missing = 1 where id = ?", r.id);
      n++;
    }
    ctx.removeWebCopiesOf(rows);
    ctx.remember("bin", `${n}`, { kind: "bin", ids: rows.map((r) => r.id) }, rows.map((r) => r.id));
    ctx.push("photos");
    return n;
  }

  async function restoreBin(ids: number[]) {
    let n = 0;
    for (const b of all<{ photo_id: number; from_path: string; bin_path: string | null }>(`select * from bin where photo_id in (${marks(ids.length)})`, ...ids)) {
      const p = one<{ missing: number }>("select missing from photos where id = ?", b.photo_id);
      if (p && !p.missing) {
        // Already back (imported again): the binned copy isn't needed.
        if (b.bin_path) await rm(b.bin_path, { force: true });
      } else if (b.bin_path && existsSync(b.bin_path)) {
        await mkdir(path.dirname(b.from_path), { recursive: true });
        const to = await freeName(b.from_path);
        await moveFile(b.bin_path, to);
        run("update photos set path = ?, missing = 0 where id = ?", to, b.photo_id);
        n++;
      }
      run("delete from bin where photo_id = ?", b.photo_id);
    }
    ctx.remember("restore", `${n}`, null, ids);
    ctx.push("photos");
    return n;
  }

  // After 30 days the Bin's photos go to the computer's own Trash and the
  // library forgets them.
  async function emptyBin(olderThanDays = 30) {
    const rows = all<{ photo_id: number; bin_path: string | null }>("select photo_id, bin_path from bin where at < ?", Date.now() - olderThanDays * DAY);
    for (const r of rows) {
      if (r.bin_path && existsSync(r.bin_path)) await shell.trashItem(r.bin_path).catch(() => {});
      tx(ctx.db(), () => {
        run("delete from bin where photo_id = ?", r.photo_id);
        run("delete from photos where id = ? and missing = 1", r.photo_id);
      });
    }
    if (rows.length) ctx.log(`bin: ${rows.length} photos emptied`);
    ctx.push("photos");
    return rows.length;
  }

  // ---------- Folders ----------
  async function setFolderType(dir: string, was: string, now: "watched" | "skip" | "archive" | null) {
    const s = ctx.settings().get();
    if (was === "watched") ctx.settings().set({ watched: (s.watched as { path: string }[]).filter((w) => w.path !== dir) });
    else run(`update folders set ${was === "skip" ? "skip" : "archive"} = 0 where path = ?`, dir);
    run("delete from folders where skip = 0 and archive = 0");
    if (now === "watched") ctx.settings().set({ watched: [...(ctx.settings().get().watched as { path: string }[]).filter((w) => w.path !== dir), { path: dir, label: path.basename(dir) }] });
    else if (now) {
      run(`insert into folders (path, ${now}) values (?, 1) on conflict (path) do update set ${now} = 1`, dir);
      if (now === "skip") run("update photos set missing = 1 where path like ?", `${dir}${path.sep}%`);
    }
    if (was === "skip" || now === "skip") await ctx.engine()?.scan();
    ctx.push("all");
  }

  // Event folders whose names aren't "YYYY-MM-DD Name" (for example
  // "20201012" or "Sports day"), renamed with the photos' own date.
  async function fixFolderNames(dryRun: boolean) {
    const rows = all<{ event_key: string; event_title: string | null; event_date: string | null; first: string | null }>(
      "select event_key, max(event_title) event_title, max(event_date) event_date, min(taken_at) first from photos where missing = 0 and event_key is not null group by event_key",
    );
    const plan: { key: string; from: string; to: string; title: string; date: string }[] = [];
    for (const r of rows) {
      const last = r.event_key.split("/").pop()!;
      if (/^\d{4}-\d{2}-\d{2} \S/.test(last)) continue;
      const g = guessEvent(last);
      const date = r.event_date ?? g.date ?? r.first?.slice(0, 10);
      if (!date) continue;
      const title = g.title || r.event_title || "Event";
      plan.push({ key: r.event_key, from: last, to: `${date} ${title}`, title, date });
    }
    if (dryRun) return plan;
    for (const p of plan) await ctx.engine()?.renameEvent(p.key, p.title, p.date).catch((e) => ctx.log(`rename ${p.key}: ${e}`));
    ctx.remember("rename", `${plan.length}`, null);
    return plan;
  }

  // ---------- Archive drive ----------
  function archiveYears() {
    const current = schoolYear(new Date());
    const root = lib();
    return all<{ year: string; n: number; size: number }>(
      "select year, count(*) n, sum(size) size from photos where missing = 0 and year is not null group by year order by year",
    )
      .filter(() => !!root)
      .map((y) => ({ ...y, old: y.year < current && Number(y.year.slice(0, 4)) < Number(current.slice(0, 4)) - 1 }));
  }

  // Copy, check the size, then remove from the library drive. The photo's
  // record follows it, so names, faces and picks stay.
  async function archiveMove(years: string[]) {
    const archive = ctx.settings().get().archive as string | null;
    const root = lib();
    if (!archive || !root || !existsSync(archive)) throw new Error("no-archive");
    let moved = 0;
    for (const year of years) {
      const rows = all<{ id: number; path: string; size: number }>("select id, path, size from photos where year = ? and missing = 0", year);
      for (const r of rows) {
        const rel = path.relative(root, r.path);
        if (rel.startsWith("..")) continue;
        const to = path.join(archive, rel);
        try {
          await mkdir(path.dirname(to), { recursive: true });
          await copyFile(r.path, to);
          if ((await stat(to)).size !== statSync(r.path).size) throw new Error("size");
          await unlink(r.path);
          run("update photos set path = ? where id = ?", to, r.id);
          moved++;
        } catch (e) {
          ctx.log(`archive ${r.path}: ${e}`);
        }
        if (moved % 50 === 0) ctx.message(`archive:${moved}`);
      }
    }
    run("insert into folders (path, archive) values (?, 1) on conflict (path) do update set archive = 1", archive);
    ctx.message("");
    ctx.push("photos");
    return { moved };
  }

  // ---------- School calendar ----------
  function setTerms(list: TermDates[]) {
    ctx.settings().set({ terms: list });
    setTermDates(list);
    ctx.push();
  }

  // Terms and holidays from an .ics calendar or an Excel/CSV sheet
  // (name, start, end).
  async function importCalendarFile() {
    const r = await dialog.showOpenDialog(ctx.win()!, { title: "School calendar", properties: ["openFile"], filters: [{ name: "Calendar", extensions: ["ics", "xlsx", "csv"] }] });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    const items: { name: string; start: string; end: string }[] = [];
    const day = (v: unknown) => {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v ?? "").trim();
      let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
      if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      return "";
    };
    if (/\.ics$/i.test(file)) {
      const text = (await readFile(file, "utf8")).replace(/\r?\n[ \t]/g, "");
      for (const ev of text.split("BEGIN:VEVENT").slice(1)) {
        const get = (k: string) => new RegExp(`^${k}[^:]*:(.*)$`, "m").exec(ev)?.[1]?.trim() ?? "";
        const start = day(get("DTSTART"));
        let end = day(get("DTEND")) || start;
        // All-day events end the day after.
        if (/DTEND;VALUE=DATE/.test(ev) && end > start) end = new Date(Date.parse(`${end}T12:00:00`) - DAY).toISOString().slice(0, 10);
        if (start) items.push({ name: get("SUMMARY").replace(/\\,/g, ",").slice(0, 80), start, end });
      }
    } else {
      const rows = await readSheet(file);
      for (const row of rows.slice(1)) {
        const [name, a, b] = row;
        const start = day(a);
        if (start) items.push({ name: String(name ?? "").slice(0, 80), start, end: day(b) || start });
      }
    }
    const isTerm = (n: string) => /term|semester|فصل|ترم/i.test(n);
    return { terms: items.filter((i) => isTerm(i.name)), holidays: items.filter((i) => !isTerm(i.name)) };
  }

  // ---------- Imports ----------
  function importHistory() {
    return all("select * from imports order by id desc limit 100");
  }
  async function undoImport(id: number) {
    const ids = all<{ id: number }>("select id from photos where import_id = ? and missing = 0", id).map((r) => r.id);
    const binned = ids.length ? await binPhotos(ids, "import-undone") : 0;
    run("update imports set undone = 1 where id = ?", id);
    return { binned };
  }

  return {
    bin: (ids: number[]) => binPhotos(ids),
    binList: () =>
      all(`select b.photo_id id, b.at, b.why, p.name, p.event_title, p.event_date, b.bin_path is not null as there from bin b join photos p on p.id = b.photo_id order by b.at desc limit 2000`).map((r) => ({
        ...r,
        daysLeft: Math.max(0, 30 - Math.floor((Date.now() - (r.at as number)) / DAY)),
      })),
    restoreBin: (ids: number[]) => restoreBin(ids),
    emptyBinNow: () => emptyBin(0),
    emptyBinOld: () => emptyBin(30),
    setFolderType: (dir: string, was: string, now: "watched" | "skip" | "archive" | null) => setFolderType(dir, was, now),
    fixFolderNames: (dryRun: boolean) => fixFolderNames(dryRun),
    chooseArchive: async () => {
      const dir = await ctx.chooseFolder("Archive drive for old school years");
      if (dir) ctx.settings().set({ archive: dir });
      ctx.push();
      return dir;
    },
    archiveYears: () => archiveYears(),
    archiveMove: (years: string[]) => archiveMove(years),
    setTerms: (list: TermDates[]) => setTerms(list),
    importCalendarFile: () => importCalendarFile(),
    importHistory: () => importHistory(),
    undoImport: (id: number) => undoImport(id),
    checkUpdates: async () => {
      if (!app.isPackaged) return null;
      const { autoUpdater } = await import("electron-updater");
      const r = await autoUpdater.checkForUpdates().catch(() => null);
      return r?.updateInfo && r.updateInfo.version !== app.getVersion() ? r.updateInfo.version : null;
    },
    // A problem report goes to the team with a picture of the window and
    // the end of the app's log. Without the website, the email app opens.
    reportProblem: async (text: string, shot: boolean) => {
      const logTail = existsSync(ctx.data("app.log")) ? (await readFile(ctx.data("app.log"), "utf8")).slice(-6000) : "";
      let image: string | null = null;
      if (shot && ctx.win()) {
        const img = await ctx.win()!.webContents.capturePage();
        image = `data:image/jpeg;base64,${img.resize({ width: Math.min(1400, img.getSize().width) }).toJPEG(70).toString("base64")}`;
      }
      const info = `${process.platform} ${process.arch} · ${app.getVersion()}`;
      const r = await ctx.appApi("report", { body: text.slice(0, 4000), log: logTail, screenshot: image, info }).catch(() => null);
      if (r && !r.error) return { sent: true };
      shell.openExternal(`mailto:?subject=${encodeURIComponent(`School Social Hub ${app.getVersion()} problem`)}&body=${encodeURIComponent(`${text}\n\n---\n${info}`)}`);
      return { sent: false };
    },
  };
}

// The Bin empties itself once a day when the school leaves the switch on.
export function binTimer(ctx: Ctx, api: Api) {
  return setInterval(() => {
    if (ctx.settings().get().binAuto) (api.emptyBinOld as () => Promise<number>)().catch(() => {});
  }, 6 * 3600_000);
}

// Once a month, if there's a good amount to free, a reminder to clean up.
// The first month starts counting the day the app is first used.
export function cleanTimer(ctx: Ctx) {
  const check = async () => {
    const s = ctx.settings().get() as { cleanReminder?: boolean; library?: string; lastCleanReminder?: number };
    if (!s.cleanReminder || !s.library) return;
    if (!s.lastCleanReminder) return ctx.settings().set({ lastCleanReminder: Date.now() });
    if (Date.now() - (s.lastCleanReminder ?? 0) < 30 * DAY) return;
    const r = await ctx.call("cleanup").catch(() => null);
    if (!r) return;
    const bytes = r.exact.size + r.sizes.size + r.bursts.size + r.bad.size + r.rejected.size + r.cache;
    ctx.settings().set({ lastCleanReminder: Date.now() });
    if (bytes < 200 * 1024 * 1024) return;
    // The window shows it (as a notification, outside quiet hours).
    ctx.message(`clean:${bytes}`);
  };
  setTimeout(() => check().catch(() => {}), 60_000);
  return setInterval(() => check().catch(() => {}), 6 * 3600_000);
}
