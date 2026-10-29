import { schoolYear } from "../core/students";
import { marks, q, type Api, type Ctx } from "./ctx";

// Coverage: is every student in the school's photos and posts, fairly?
// Only good photos count (sharp, face clear and big enough, not hidden), a
// student should be the focus of at least one, photos should vary by
// category, posts should be shared fairly between students and classes, and
// each student needs enough for the yearbook. Students who joined or left
// only count for their own years.
type Filter = { year?: string; term?: string; event?: string; className?: string; group?: number };
type Person = { id: string; name_en: string | null; name_ar: string | null; class_name: string | null; stage: string | null; grade: string | null; can_post: number; joined: string | null };
type Row = { sid: string; pid: number; good: number; focus: number; posts: number; category: string | null; day: string | null; event_key: string | null };
const DAY = 86400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function coverageApi(ctx: Ctx): Api {
  const { one, all } = q(ctx);

  // Who counts: this year's students, or (for an earlier year) those who
  // were at the school that year, in the class they were in then.
  function population(f: Filter): Person[] {
    const past = f.year && f.year !== schoolYear() && (one<{ n: number }>("select count(*) n from school_history where year = ?", f.year)?.n ?? 0) > 0;
    const base = past
      ? all<Person>("select s.id, s.name_en, s.name_ar, h.class_name, s.stage, s.grade, s.can_post, s.joined from school_history h join students s on s.id = h.student_id where h.year = ? and s.kind = 'student'", f.year)
      : all<Person>("select id, name_en, name_ar, class_name, stage, grade, can_post, joined from students where kind = 'student' and left_on is null");
    let out = base;
    if (f.className) out = out.filter((p) => p.class_name === f.className);
    if (f.group) {
      const m = new Set(all<{ student_id: string }>("select student_id from group_members where group_id = ?", f.group).map((r) => r.student_id));
      out = out.filter((p) => m.has(p.id));
    }
    return out;
  }

  function rowsFor(ids: string[], f: Filter): Row[] {
    if (!ids.length) return [];
    const where = ["f.status in ('confirmed', 'manual')", "p.missing = 0"];
    const args: unknown[] = [];
    if (f.year) (where.push("p.year = ?"), args.push(f.year));
    if (f.term) (where.push("p.term = ?"), args.push(f.term));
    if (f.event) (where.push("p.event_key = ?"), args.push(f.event));
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i += 800) {
      const part = ids.slice(i, i + 800);
      out.push(
        ...all<Row>(
          `select f.student_id sid, p.id pid,
             (coalesce(p.problems, '') = '' and p.hidden = 0 and f.w * coalesce(p.width, 0) >= 48) good,
             (f.w >= 0.12 or p.face_count <= 3 or f.w >= (select max(f2.w) from faces f2 where f2.photo_id = p.id) * 0.95 and p.face_count <= 6) focus,
             p.posts, p.category, substr(coalesce(p.taken_at, p.event_date), 1, 10) day, p.event_key
           from faces f join photos p on p.id = f.photo_id where ${where.join(" and ")} and f.student_id in (${marks(part.length)})`,
          ...args,
          ...part,
        ),
      );
    }
    return out;
  }

  function report(f: Filter = {}) {
    const people = population(f);
    const rows = rowsFor(people.map((p) => p.id), f);
    const by = new Map<string, Row[]>();
    for (const r of rows) (by.get(r.sid) ?? by.set(r.sid, []).get(r.sid)!).push(r);
    const stale = iso(Date.now() - 21 * DAY);
    const students = people.map((p) => {
      const mine = by.get(p.id) ?? [];
      const photos = new Set(mine.map((r) => r.pid));
      const good = new Set(mine.filter((r) => r.good).map((r) => r.pid));
      const focus = new Set(mine.filter((r) => r.good && r.focus).map((r) => r.pid));
      const posted = new Set(mine.filter((r) => r.posts > 0).map((r) => r.pid));
      const events = new Set(mine.filter((r) => r.good).map((r) => r.event_key ?? ""));
      const cats: Record<string, number> = {};
      for (const r of mine) if (r.good && r.category) cats[r.category] = (cats[r.category] ?? 0) + 1;
      const last = mine.reduce<string | null>((a, r) => (r.day && (!a || r.day > a) ? r.day : a), null);
      const g = good.size;
      return {
        ...p,
        photos: photos.size,
        good: g,
        focus: focus.size,
        posted: posted.size,
        events: events.size,
        cats,
        last,
        stale: !last || last < stale,
        status: !p.can_post ? "nopost" : g === 0 ? "zero" : g < 3 ? "low" : "good",
        // Enough for a yearbook page: 3 good photos from 2 events, one where they're the focus.
        ready: g >= 3 && focus.size >= 1 && events.size >= 2,
        tooOften: false,
      };
    });
    // Fair share in posts: someone in far more posts than the average is flagged.
    const counted = students.filter((s) => s.can_post);
    const avgPosted = counted.length ? counted.reduce((a, s) => a + s.posted, 0) / counted.length : 0;
    for (const s of counted) s.tooOften = s.posted >= Math.max(4, avgPosted * 2.5);
    const classes = new Map<string, any>();
    for (const s of students) {
      const k = s.class_name ?? "—";
      const c = classes.get(k) ?? { className: k, stage: s.stage, grade: s.grade, students: 0, zero: 0, low: 0, good: 0, nopost: 0, stale: 0, photos: 0, posted: 0, ready: 0, noFocus: 0, tooOften: 0, cats: {} as Record<string, number> };
      classes.set(k, c);
      if (!s.can_post) {
        c.nopost++;
        continue;
      }
      c.students++;
      c[s.status]++;
      c.photos += s.good;
      c.posted += s.posted;
      if (s.stale) c.stale++;
      if (s.ready) c.ready++;
      if (s.good && !s.focus) c.noFocus++;
      if (s.tooOften) c.tooOften++;
      for (const [cat, n] of Object.entries(s.cats)) c.cats[cat] = (c.cats[cat] ?? 0) + n;
    }
    const order = all<{ class_name: string | null }>(
      `select class_name from students where kind = 'student' group by class_name order by case when grade like 'KG%' then 0 else 1 end, cast(replace(replace(grade, 'Grade ', ''), 'KG', '') as integer), class_name`,
    ).map((r) => r.class_name ?? "—");
    const list = [...classes.values()].sort((a, b) => order.indexOf(a.className) - order.indexOf(b.className));
    for (const c of list) c.postsPerStudent = c.students ? +(c.posted / c.students).toFixed(1) : 0;
    return { students, classes: list, avgPosted: +avgPosted.toFixed(1), heat: heat(students, rows), categories: all<{ category: string; n: number }>("select category, count(*) n from photos where category is not null and missing = 0 group by category order by n desc").map((r) => r.category) };
  }

  // Weeks heat map: how many good photos each class had, week by week.
  function heat(students: { id: string; class_name: string | null }[], rows: Row[], weeks = 16) {
    const classOf = new Map(students.map((s) => [s.id, s.class_name ?? "—"]));
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const starts = Array.from({ length: weeks }, (_, i) => iso(monday.getTime() - (weeks - 1 - i) * 7 * DAY + 12 * 3600_000));
    const cells = new Map<string, Set<number>[]>();
    for (const r of rows) {
      if (!r.good || !r.day || r.day < starts[0]) continue;
      const k = classOf.get(r.sid) ?? "—";
      let w = starts.length - 1;
      while (w > 0 && r.day < starts[w]) w--;
      const arr = cells.get(k) ?? cells.set(k, starts.map(() => new Set<number>())).get(k)!;
      arr[w].add(r.pid);
    }
    return { weeks: starts, rows: Object.fromEntries([...cells.entries()].map(([k, v]) => [k, v.map((s) => s.size)])) };
  }

  // "Fill the gap": photos already in the library (good, not posted, nobody
  // in them who can't appear) that together show the most students who have
  // been in no posts yet, ready to become a post.
  function fillGap(f: Filter = {}, max = 10) {
    const r = report(f);
    const need = new Set(r.students.filter((s) => s.can_post && s.posted === 0).map((s) => s.id));
    if (!need.size) return { ids: [], students: [], missing: 0 };
    const cands = all<{ pid: number; sid: string }>(
      `select p.id pid, f.student_id sid from faces f join photos p on p.id = f.photo_id
       where f.status in ('confirmed', 'manual') and p.missing = 0 and p.hidden = 0 and p.posts = 0 and coalesce(p.problems, '') = '' and p.dup_of is null
         and not exists (select 1 from faces f2 join students s2 on s2.id = f2.student_id where f2.photo_id = p.id and f2.status in ('confirmed', 'manual') and s2.can_post = 0)
         and f.student_id in (select value from json_each(?))`,
      JSON.stringify([...need]),
    );
    const byPhoto = new Map<number, Set<string>>();
    for (const c of cands) (byPhoto.get(c.pid) ?? byPhoto.set(c.pid, new Set()).get(c.pid)!).add(c.sid);
    const left = new Set(need);
    const ids: number[] = [];
    while (ids.length < max && left.size) {
      let best = -1, n = 0;
      for (const [pid, set] of byPhoto) {
        const k = [...set].filter((x) => left.has(x)).length;
        if (k > n) (best = pid), (n = k);
      }
      if (best < 0) break;
      ids.push(best);
      byPhoto.get(best)!.forEach((x) => left.delete(x));
      byPhoto.delete(best);
    }
    const covered = [...need].filter((x) => !left.has(x));
    return { ids, students: covered, missing: need.size };
  }

  // The shot list: students with no good photos or only 1-2, and those never
  // the focus; it can go to the photographer's or teacher's phone for the event.
  function shotList(f: Filter = {}) {
    const r = report(f);
    return r.students
      .filter((s) => s.can_post && (s.good < 3 || !s.focus))
      .sort((a, b) => a.good - b.good)
      .map((s) => ({ code: s.id, name_en: s.name_en, name_ar: s.name_ar, className: s.class_name, good: s.good, focus: s.focus }));
  }
  async function sendShotList(f: Filter, title: string, date: string) {
    const list = shotList(f);
    await ctx.appApi("shotList", { title, date, className: f.className ?? null, students: list.slice(0, 300) });
    return list.length;
  }

  return {
    coverage: (f?: Filter) => report(f),
    fillGap: (f?: Filter) => fillGap(f),
    shotList: (f?: Filter) => shotList(f),
    sendShotList: (f: Filter, title: string, date: string) => sendShotList(f, title, date),
  };
}
