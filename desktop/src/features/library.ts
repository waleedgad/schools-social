import { existsSync } from "node:fs";
import path from "node:path";
import { clipboard, nativeImage, shell } from "electron";
import { tx } from "../core/db";
import { finderTags } from "../core/vision";
import { schoolYear, term } from "../core/library";
import { marks, q, type Api, type Ctx } from "./ctx";

// The Library's questions: which photos, which albums, which events. Albums
// come in sections: smart, to do, my albums, categories, occasions, people,
// classes and yearbooks. Counts are live, and empty albums hide.

export type Filter = {
  event?: string;
  year?: string;
  term?: string;
  className?: string;
  stage?: string;
  grade?: string;
  album?: string;
  student?: string;
  together?: string[];
  kind?: string;
  search?: string;
  minRating?: number;
  flag?: number;
  label?: string;
  photographer?: string;
  ids?: number[];
  sort?: "time" | "quality" | "name" | "faces" | "unnamed" | "newest";
  limit?: number;
};

export const PHOTO_COLUMNS = `p.id, p.name, p.path, p.width, p.height, p.rating, p.flag, p.label, p.face_count, p.is_raw, p.quality, p.taken_at, p.dhash, p.missing, p.hidden,
  p.event_key, p.event_title, p.event_date, p.class_name, p.remote_id, p.thumb, p.faces_scanned, p.posts, p.photographer, p.category, p.problems, p.smile, p.year, p.term,
  (select count(*) from photos r where r.pair_of = p.id) as has_raw,
  (select count(*) from photos e where e.edited_of = p.id and e.missing = 0) as edits,
  (select count(*) from faces f where f.photo_id = p.id and f.status in ('confirmed', 'manual')) as tagged,
  (select count(*) from faces f where f.photo_id = p.id and f.status = 'suggested') as suggested,
  (select count(*) from faces f where f.photo_id = p.id and f.status in ('unknown', 'suggested')) as unnamed,
  (select count(*) from faces f join students s on s.id = f.student_id where f.photo_id = p.id and f.status in ('confirmed', 'manual') and s.can_post = 0) as no_post`;

// What each kind of event is, read from its name (Arabic or English) or
// from the category chosen at import. Only names are read: no photo leaves
// the computer for this.
export const CATEGORY_WORDS: Record<string, RegExp> = {
  sports: /sport|football|soccer|match|race|relay|athlet|swim|basket|volley|olymp|tournament|run|رياض|مباراة|سباق|كرة|سباحة|بطولة|جري/i,
  art: /\bart|drawing|paint|music|drama|theat|choir|concert|dance|craft|فن|رسم|موسيق|مسرح|كورال|حفلة موسيقية|رقص/i,
  science: /scien|stem|steam|lab|robot|experiment|coding|math|tech|علوم|تجرب|روبوت|معمل|برمج|رياضيات|تكنولوج/i,
  celebrations: /celebrat|party|festival|eid|ramadan|national|graduat|christmas|mother|teacher.?s day|anniversar|احتفال|عيد|حفل|تخرج|رمضان|وطني|الأم|المعلم/i,
  assemblies: /assembl|morning|flag|line ?up|طابور|إذاعة|اذاعة|تحية العلم/i,
  trips: /trip|visit|excursion|museum|zoo|tour|camp|رحلة|زيارة|متحف|حديقة|معسكر/i,
};
export function categoryOf(title: string | null, chosen?: string | null) {
  if (chosen) return chosen;
  for (const [k, re] of Object.entries(CATEGORY_WORDS)) if (title && re.test(title)) return k;
  return null;
}

// Occasions, any year: by the Hijri calendar (Ramadan, the two Eids,
// Islamic New Year, the Prophet's birthday) and by fixed days.
const HIJRI = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { month: "numeric", day: "numeric" });
export function hijriOf(d: string) {
  const parts = HIJRI.formatToParts(new Date(`${d.slice(0, 10)}T12:00:00`));
  return { m: Number(parts.find((p) => p.type === "month")?.value), d: Number(parts.find((p) => p.type === "day")?.value) };
}
export const OCCASIONS: { id: string; test: (iso: string, h: { m: number; d: number }) => boolean }[] = [
  { id: "firstday", test: (iso) => /-09-(0\d|1[0-9])$/.test(iso.slice(0, 10)) },
  { id: "ramadan", test: (_i, h) => h.m === 9 },
  { id: "eidfitr", test: (_i, h) => h.m === 10 && h.d <= 4 },
  { id: "eidadha", test: (_i, h) => h.m === 12 && h.d >= 9 && h.d <= 13 },
  { id: "hijrinew", test: (_i, h) => h.m === 1 && h.d <= 2 },
  { id: "mawlid", test: (_i, h) => h.m === 3 && h.d >= 11 && h.d <= 13 },
  { id: "national", test: (iso) => ["10-06", "07-23", "01-25", "04-25"].includes(iso.slice(5, 10)) },
  { id: "teachers", test: (iso) => iso.slice(5, 10) === "10-05" },
  { id: "mothers", test: (iso) => iso.slice(5, 10) === "03-21" },
  { id: "graduation", test: () => false },
];

const hamming = (a: string, b: string) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) n += ((parseInt(a[i], 16) ^ parseInt(b[i], 16)) >>> 0).toString(2).replace(/0/g, "").length;
  return n;
};

export function libraryApi(ctx: Ctx): Api {
  const { one, all, run } = q(ctx);
  const library = () => ctx.settings().get().library as string | null;

  // Occasion days present in the library, worked out once per date.
  let occasionCache: { at: number; byOccasion: Map<string, string[]> } | null = null;
  function occasionDays() {
    if (occasionCache && Date.now() - occasionCache.at < 60_000) return occasionCache.byOccasion;
    const days = all<{ d: string }>("select distinct substr(coalesce(taken_at, event_date), 1, 10) d from photos where missing = 0 and coalesce(taken_at, event_date) is not null").map((r) => r.d);
    const byOccasion = new Map<string, string[]>();
    for (const d of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const h = hijriOf(d);
      for (const o of OCCASIONS) if (o.test(d, h)) byOccasion.set(o.id, [...(byOccasion.get(o.id) ?? []), d]);
    }
    occasionCache = { at: Date.now(), byOccasion };
    return byOccasion;
  }

  function eventCategories() {
    const rows = all<{ event_key: string; title: string | null; cat: string | null }>("select event_key, max(event_title) title, max(category) cat from photos where missing = 0 and event_key is not null group by event_key");
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const c = categoryOf(r.title, r.cat);
      if (c) map.set(c, [...(map.get(c) ?? []), r.event_key]);
    }
    return map;
  }

  function photoWhere(f: Filter) {
    // Photos whose original went missing still show (from their small copy)
    // with an "Original missing" badge, unless they are in the Bin or in a
    // skipped folder.
    const where = [
      `(p.missing = 0 or (p.thumb = 1 and p.path not like ':%' and not exists (select 1 from bin b where b.photo_id = p.id) and not exists (select 1 from folders fo where fo.skip = 1 and p.path like fo.path || '%')))`,
      "p.pair_of is null",
      "p.dup_of is null",
      "p.edited_of is null",
    ];
    const args: unknown[] = [];
    if (f.album !== "hidden") where.push("p.hidden = 0");
    if (f.ids?.length) (where.push(`p.id in (${marks(f.ids.length)})`), args.push(...f.ids));
    if (f.event) (where.push("p.event_key = ?"), args.push(f.event));
    if (f.year) (where.push("p.year = ?"), args.push(f.year));
    if (f.term) (where.push("p.term = ?"), args.push(f.term));
    const named = "f.status in ('confirmed','manual')";
    if (f.className) {
      where.push(`(p.class_name = ? or exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and ${named} and s.class_name = ?))`);
      args.push(f.className, f.className);
    } else if (f.grade) {
      where.push(`(exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and ${named} and s.grade = ?) or p.class_name in (select class_name from students where grade = ?))`);
      args.push(f.grade, f.grade);
    } else if (f.stage) {
      where.push(`(exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and ${named} and s.stage = ?) or p.class_name in (select class_name from students where stage = ?))`);
      args.push(f.stage, f.stage);
    }
    if (f.student) (where.push(`exists (select 1 from faces f where f.photo_id = p.id and f.student_id = ? and ${named})`), args.push(f.student));
    for (const t of f.together ?? []) (where.push(`exists (select 1 from faces f where f.photo_id = p.id and f.student_id = ? and ${named})`), args.push(t));
    if (f.kind) (where.push(`exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and ${named} and s.kind = ?)`), args.push(f.kind));
    if (f.minRating) (where.push("p.rating >= ?"), args.push(f.minRating));
    if (f.flag !== undefined && f.flag !== null) (where.push("p.flag = ?"), args.push(f.flag));
    if (f.label) (where.push("p.label = ?"), args.push(f.label));
    if (f.photographer) (where.push("p.photographer = ?"), args.push(f.photographer));
    if (f.search) {
      where.push("(p.name like ? or p.event_title like ? or p.class_name like ? or p.words like ? or p.photographer like ?)");
      args.push(...Array(5).fill(`%${f.search}%`));
    }
    const a = f.album ?? "";
    switch (a) {
      case "picks": where.push("p.flag = 1"); break;
      case "rejected": where.push("p.flag = -1"); break;
      case "five": where.push("p.rating = 5"); break;
      case "week": where.push("p.added_at > ?"); args.push(Date.now() - 7 * 86400_000); break;
      case "untagged": where.push("exists (select 1 from faces f where f.photo_id = p.id and f.status in ('unknown', 'suggested'))"); break;
      case "nofaces": where.push("p.faces_scanned = 1 and p.face_count = 0"); break;
      case "notsent": where.push("p.remote_id is null and p.flag = 1"); break;
      case "sent": where.push("p.remote_id is not null"); break;
      case "posted": where.push("p.posts > 0"); break;
      case "nopost": where.push(`exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and ${named} and s.can_post = 0)`); break;
      case "noevent": where.push("p.event_key is null"); break;
      case "raw": where.push("(p.is_raw = 1 or exists (select 1 from photos r where r.pair_of = p.id))"); break;
      // Ready to post: picked, not in a post yet, original there.
      case "ready": where.push("p.flag = 1 and p.posts = 0 and p.missing = 0"); break;
      case "tocull": where.push("p.flag = 0 and p.rating = 0 and p.added_at > ?"); args.push(Date.now() - 30 * 86400_000); break;
      case "fix": where.push("p.flag >= 0 and p.problems is not null and p.problems != ''"); break;
      case "missing": where.push("p.missing = 1"); break;
      case "hidden": where.push("p.hidden = 1"); break;
      case "groups": where.push("p.face_count >= 5"); break;
      case "smiles": where.push("p.face_count >= 3 and p.smile is not null"); break;
      case "lastyear":
        where.push("substr(coalesce(p.taken_at, p.event_date), 6, 5) between ? and ? and substr(coalesce(p.taken_at, p.event_date), 1, 4) < ?");
        {
          const d = new Date();
          const from = new Date(d.getTime() - 3 * 86400_000).toISOString().slice(5, 10);
          const to = new Date(d.getTime() + 3 * 86400_000).toISOString().slice(5, 10);
          args.push(from <= to ? from : "01-01", from <= to ? to : "12-31", String(d.getFullYear()));
        }
        break;
      case "red": case "yellow": case "green": where.push("p.label = ?"); args.push(a); break;
      default:
        if (a.startsWith("my:")) {
          const album = one<{ id: number; rule: string | null }>("select id, rule from albums where id = ?", Number(a.slice(3)));
          if (!album) where.push("0");
          else if (!album.rule) (where.push("exists (select 1 from album_photos x where x.album_id = ? and x.photo_id = p.id)"), args.push(album.id));
          else ruleWhere(JSON.parse(album.rule), where, args);
        } else if (a.startsWith("cat:")) {
          const keys = eventCategories().get(a.slice(4)) ?? [];
          where.push(`(p.category = ? or p.event_key in (${keys.length ? marks(keys.length) : "null"}))`);
          args.push(a.slice(4), ...keys);
        } else if (a.startsWith("occ:")) {
          const id = a.slice(4);
          if (id === "graduation") where.push("(p.event_title like '%graduat%' or p.event_title like '%تخرج%')");
          else {
            const days = occasionDays().get(id) ?? [];
            where.push(`substr(coalesce(p.taken_at, p.event_date), 1, 10) in (${days.length ? marks(days.length) : "null"})`);
            args.push(...days);
          }
        } else if (a.startsWith("book:")) {
          // Yearbook album: this year's good photos of a grade's students.
          const [grade, year] = a.slice(5).split("|");
          where.push(`p.year = ? and (p.flag = 1 or p.rating >= 3) and exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and ${named} and s.grade = ?)`);
          args.push(year, grade);
        } else if (a.startsWith("imp:")) {
          // One import, open while it is still copying.
          where.push("p.import_id = ?");
          args.push(Number(a.slice(4)));
        } else if (a.startsWith("kind:")) {
          where.push(`exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and ${named} and s.kind = ?)`);
          args.push(a.slice(5));
        }
    }
    return { where, args };
  }

  function photos(f: Filter) {
    const { where, args } = photoWhere(f);
    const order =
      f.sort === "quality" ? "p.quality desc"
      : f.sort === "name" ? "p.name"
      : f.sort === "faces" ? "p.face_count desc, p.taken_at"
      : f.sort === "unnamed" ? "unnamed desc, p.taken_at"
      : f.sort === "newest" ? "coalesce(p.taken_at, p.event_date) desc, p.name"
      : f.album === "smiles" ? "p.smile desc"
      : "coalesce(p.taken_at, p.event_date), p.name";
    const lib = library();
    const rows = all<Record<string, any>>(`select ${PHOTO_COLUMNS} from photos p where ${where.join(" and ")} order by ${order} limit ?`, ...args, f.limit ?? 8000);
    // Photos on an archive drive that is unplugged show from their small copy.
    for (const r of rows) {
      r.offline = r.missing ? 1 : lib && path.relative(lib, r.path).startsWith("..") && !existsSync(r.path) ? 1 : 0;
      delete r.path;
    }
    return rows;
  }

  function countPhotos(f: Filter) {
    const { where, args } = photoWhere(f);
    return one<{ n: number }>(`select count(*) n from photos p where ${where.join(" and ")}`, ...args)?.n ?? 0;
  }

  function tree() {
    const base = "missing = 0 and pair_of is null and dup_of is null and edited_of is null and hidden = 0";
    const rows = all(
      `select year, term, event_key, max(event_title) event_title, max(event_date) event_date, count(*) n, sum(flag = 1) picks, min(id) cover from photos
       where ${base} group by year, term, event_key order by year desc, term desc, max(event_date) desc`,
    );
    const classes = all(`select event_key, class_name, count(*) n from photos where ${base} and class_name is not null group by event_key, class_name order by class_name`);
    return { rows, classes };
  }

  function albums() {
    const ids = ["all", "week", "picks", "five", "lastyear", "nofaces", "raw", "sent", "posted", "groups", "smiles", "red", "yellow", "green", "ready", "tocull", "untagged", "fix", "nopost", "noevent", "notsent", "missing", "rejected", "hidden"];
    const counts: Record<string, number> = {};
    for (const id of ids) counts[id] = countPhotos({ album: id });
    const cover = (album: string) => (photos({ album, limit: 1, sort: "quality" })[0] as { id?: number } | undefined)?.id ?? null;
    const mine = all<{ id: number; name: string; rule: string | null; shared: number }>("select id, name, rule, shared from albums order by name").map((x) => ({ ...x, n: countPhotos({ album: `my:${x.id}` }), cover: cover(`my:${x.id}`) }));
    const cats = [...eventCategories().keys()].map((c) => ({ id: `cat:${c}`, key: c, n: countPhotos({ album: `cat:${c}` }) })).filter((c) => c.n);
    for (const c of cats) (c as Record<string, unknown>).cover = cover(c.id);
    const occ = OCCASIONS.map((o) => ({ id: `occ:${o.id}`, key: o.id, n: countPhotos({ album: `occ:${o.id}` }) })).filter((o) => o.n);
    const year = (one<{ y: string }>("select max(year) y from photos where missing = 0 and year is not null")?.y) ?? null;
    const grades = year
      ? all<{ grade: string; stage: string | null }>("select distinct grade, stage from students where grade is not null and kind = 'student'").map((g) => ({ id: `book:${g.grade}|${year}`, grade: g.grade, stage: g.stage, year, n: countPhotos({ album: `book:${g.grade}|${year}` }) })).filter((g) => g.n)
      : [];
    const kinds = ["teacher", "staff", "parent", "visitor"].map((k) => ({ id: `kind:${k}`, key: k, n: countPhotos({ album: `kind:${k}` }) })).filter((k) => k.n);
    const photographers = all<{ photographer: string; n: number }>("select photographer, count(*) n from photos where missing = 0 and photographer is not null and photographer != '' group by photographer order by n desc limit 40");
    return { counts, mine, cats, occ, grades, kinds, photographers };
  }

  // Which event a stray photo probably belongs to: one with photos taken
  // the same day (or the day's school event).
  function suggestEvents(ids: number[]) {
    const rows = all<{ id: number; d: string | null }>(`select id, substr(taken_at, 1, 10) d from photos where id in (${marks(ids.length)})`, ...ids);
    const out: { id: number; event_key: string; title: string; date: string }[] = [];
    const cache = new Map<string, { event_key: string; title: string; date: string } | null>();
    for (const r of rows) {
      if (!r.d) continue;
      if (!cache.has(r.d))
        cache.set(
          r.d,
          one<{ event_key: string; title: string; date: string }>(
            "select event_key, max(event_title) title, max(event_date) date, count(*) n from photos where event_key is not null and missing = 0 and (event_date = ? or substr(taken_at, 1, 10) = ?) group by event_key order by n desc limit 1",
            r.d,
            r.d,
          ) ?? null,
        );
      const e = cache.get(r.d);
      if (e) out.push({ id: r.id, ...e });
    }
    return out;
  }

  // Everything the info panel shows about one photo.
  function info(id: number) {
    const p = one<Record<string, any>>("select * from photos where id = ?", id);
    if (!p) return null;
    const people = all("select s.id, s.name_en, s.name_ar, s.kind, s.class_name, f.status, f.auto from faces f join students s on s.id = f.student_id where f.photo_id = ? and f.status in ('confirmed', 'manual')", id);
    const albums = all("select a.id, a.name from albums a join album_photos x on x.album_id = a.id where x.photo_id = ?", id);
    const imp = p.import_id ? one("select at, who, photographer, source from imports where id = ?", p.import_id) : null;
    const lib = library();
    return {
      ...p,
      embedding: undefined,
      clip: undefined,
      people,
      albums,
      import: imp,
      there: !p.missing && existsSync(p.path),
      archived: !!lib && path.relative(lib, p.path).startsWith(".."),
      category: categoryOf(p.event_title, p.category),
    };
  }

  async function setHidden(ids: number[], hidden: boolean) {
    const before = all<{ id: number; hidden: number }>(`select id, hidden from photos where id in (${marks(ids.length)})`, ...ids);
    run(`update photos set hidden = ? where id in (${marks(ids.length)})`, hidden ? 1 : 0, ...ids);
    ctx.remember("hide", `${ids.length}`, { kind: "sql", steps: before.map((b) => ["update photos set hidden = ? where id = ?", [b.hidden, b.id]]) }, ids);
    ctx.push("photos");
  }

  return {
    tree: () => tree(),
    photos: (f: Filter) => photos(f),
    countPhotos: (f: Filter) => countPhotos(f),
    albums: () => albums(),
    suggestEvents: (ids: number[]) => suggestEvents(ids),
    applySuggestedEvents: async (moves: { id: number; title: string; date: string }[]) => {
      const groups = new Map<string, { title: string; date: string; ids: number[] }>();
      for (const m of moves) {
        const k = `${m.date}|${m.title}`;
        const g = groups.get(k) ?? { title: m.title, date: m.date, ids: [] };
        g.ids.push(m.id);
        groups.set(k, g);
      }
      const undo = [];
      for (const g of groups.values()) undo.push(...((await ctx.engine()?.moveTo(g.ids, { title: g.title, date: g.date })) ?? []));
      ctx.remember("move", `${undo.length}:suggested events`, { kind: "move", items: undo }, undo.map((u) => u.id));
      return undo.length;
    },
    photoInfo: (id: number) => info(id),
    setHidden: (ids: number[], hidden: boolean) => setHidden(ids, hidden),
    setAlbumShared: async (id: number, shared: boolean) => {
      run("update albums set shared = ? where id = ?", shared ? 1 : 0, id);
      if (shared) {
        const ids = photos({ album: `my:${id}` }).map((p) => p.id as number);
        const a = one<{ name: string }>("select name from albums where id = ?", id);
        await ctx.appApi("shareAlbum", { localId: id, name: a?.name, photos: all<{ remote_id: string }>(`select remote_id from photos where id in (${marks(ids.length || 1)}) and remote_id is not null`, ...(ids.length ? ids : [0])).map((r) => r.remote_id) }).catch(() => null);
      } else await ctx.appApi("unshareAlbum", { localId: id }).catch(() => null);
      ctx.push("photos");
    },
    copyPhoto: async (id: number) => {
      const file = await ctx.engine()?.preview(id);
      if (file) clipboard.writeImage(nativeImage.createFromPath(file));
    },
    revealMany: (ids: number[]) => {
      const p = all<{ path: string }>(`select path from photos where id in (${marks(ids.length)})`, ...ids);
      if (p[0]) shell.showItemInFolder(p[0].path);
    },
    // Green Finder tag on picks (Mac only). Files only get the tag, never
    // a name or face.
    tagPicksInFinder: async (ids: number[], on: boolean) => {
      if (process.platform !== "darwin") return 0;
      const files = all<{ path: string }>(`select path from photos where id in (${marks(ids.length)}) and missing = 0`, ...ids).map((r) => r.path);
      return finderTags(files, on);
    },
    // Bursts: shots seconds apart that look the same, shown as one stack.
    stacks: (ids: number[]) => {
      const rows = all<{ id: number; dhash: string | null; t: string | null; quality: number | null }>(`select id, dhash, taken_at t, quality from photos where id in (${marks(ids.length || 1)}) order by taken_at`, ...(ids.length ? ids : [0]));
      const out: number[][] = [];
      let cur: typeof rows = [];
      for (const r of rows) {
        const last = cur.at(-1);
        if (last && r.dhash && last.dhash && r.t && last.t && hamming(r.dhash, last.dhash) <= 12 && Math.abs(Date.parse(r.t) - Date.parse(last.t)) <= 4000) cur.push(r);
        else {
          if (cur.length > 1) out.push(cur.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0)).map((c) => c.id));
          cur = [r];
        }
      }
      if (cur.length > 1) out.push(cur.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0)).map((c) => c.id));
      return out;
    },
    placeFor: (date: string) => {
      const d = new Date(`${date}T12:00:00`);
      return Number.isNaN(d.getTime()) ? null : { year: schoolYear(d), term: term(d) };
    },
    faceOf: (photoId: number, studentId: string) =>
      one<{ id: number }>("select id from faces where photo_id = ? and student_id = ? and status in ('confirmed', 'manual') and w > 0 order by w desc limit 1", photoId, studentId)?.id ?? null,
    countRule: (rule: AlbumRule) => {
      const where = ["p.missing = 0", "p.pair_of is null", "p.dup_of is null", "p.edited_of is null", "p.hidden = 0"];
      const args: unknown[] = [];
      ruleWhere(rule, where, args);
      return one<{ n: number }>(`select count(*) n from photos p where ${where.join(" and ")}`, ...args)?.n ?? 0;
    },
    updateAlbum: (id: number, name: string, rule: AlbumRule | null) => {
      run("update albums set name = ?, rule = coalesce(?, rule) where id = ?", name.slice(0, 80), rule ? JSON.stringify(rule) : null, id);
      ctx.push("photos");
    },
    setCategory: (ids: number[], category: string | null) => {
      tx(ctx.db(), () => ids.forEach((id) => run("update photos set category = ? where id = ?", category, id)));
      ctx.push("photos");
    },
  };
}

type AlbumRule = {
  minRating?: number; picked?: boolean; className?: string; event?: string; student?: string; from?: string; to?: string;
  people?: "none" | "some" | "group"; sent?: boolean; label?: string; category?: string; photographer?: string; posted?: boolean; kind?: string;
};
export function ruleWhere(r: AlbumRule, where: string[], args: unknown[]) {
  if (r.minRating) (where.push("p.rating >= ?"), args.push(r.minRating));
  if (r.picked) where.push("p.flag = 1");
  if (r.className) (where.push("p.class_name = ?"), args.push(r.className));
  if (r.event) (where.push("p.event_title like ?"), args.push(`%${r.event}%`));
  if (r.student) (where.push("exists (select 1 from faces f where f.photo_id = p.id and f.student_id = ? and f.status in ('confirmed', 'manual'))"), args.push(r.student));
  if (r.from) (where.push("coalesce(p.taken_at, p.event_date) >= ?"), args.push(r.from));
  if (r.to) (where.push("coalesce(p.taken_at, p.event_date) <= ?"), args.push(`${r.to}T23:59:59`));
  if (r.people === "none") where.push("p.faces_scanned = 1 and p.face_count = 0");
  if (r.people === "some") where.push("p.face_count between 1 and 4");
  if (r.people === "group") where.push("p.face_count >= 5");
  if (r.sent !== undefined) where.push(r.sent ? "p.remote_id is not null" : "p.remote_id is null");
  if (r.posted !== undefined) where.push(r.posted ? "p.posts > 0" : "p.posts = 0");
  if (r.label) (where.push("p.label = ?"), args.push(r.label));
  if (r.photographer) (where.push("p.photographer = ?"), args.push(r.photographer));
  if (r.category) {
    const re = CATEGORY_WORDS[r.category];
    // The event-name part is checked with a word list kept in SQL-friendly form.
    if (re) {
      const words = re.source.split("|").map((w) => w.replace(/\\b|[\\^$.*+?()[\]{}]/g, "")).filter((w) => w.length > 2).slice(0, 30);
      where.push(`(p.category = ? or ${words.map(() => "lower(p.event_title) like ?").join(" or ")})`);
      args.push(r.category, ...words.map((w) => `%${w.toLowerCase()}%`));
    }
  }
  if (r.kind) (where.push("exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and f.status in ('confirmed','manual') and s.kind = ?)"), args.push(r.kind));
}
