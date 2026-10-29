import { hijriOf, OCCASIONS } from "./library";
import { q, type Api, type Ctx } from "./ctx";

// Today's cards that come from this computer: events this week and whether
// they have photos yet, recent imports, picks not used in a post, students
// not seen for three weeks, upcoming occasions and "on this day" last year.
const DAY = 86400_000;
const iso = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// The first day of each occasion in the next `days` days.
export function upcomingOccasions(from = Date.now(), days = 45) {
  const out: { id: string; date: string; inDays: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= days; i++) {
    const d = iso(from + i * DAY);
    const h = hijriOf(d);
    for (const o of OCCASIONS) {
      if (o.id === "firstday" || o.id === "graduation" || seen.has(o.id)) continue;
      if (o.test(d, h)) {
        seen.add(o.id);
        out.push({ id: o.id, date: d, inDays: i });
      }
    }
  }
  return out;
}

export function todayApi(ctx: Ctx): Api {
  const { one, all } = q(ctx);
  const good = "p.missing = 0 and p.hidden = 0 and p.dup_of is null and p.pair_of is null and p.edited_of is null";

  function local() {
    const now = Date.now();
    const weekAgo = iso(now - 6 * DAY);
    const today = iso(now);
    // Events of the last week from the library, with how many photos are picked.
    const events = all(
      `select event_key key, max(event_title) title, max(event_date) date, count(*) n, sum(flag = 1) picks, sum(posts > 0) posted,
         (select id from photos x where x.event_key = p.event_key and x.missing = 0 order by x.flag = 1 desc, x.quality desc limit 1) cover
       from photos p where ${good} and event_key is not null and event_date >= ? group by event_key order by date desc limit 12`,
      weekAgo,
    );
    const imports = all<{ id: number; at: number; source: string; copied: number; photographer: string | null }>("select id, at, source, copied, photographer from imports where undone = 0 and copied > 0 order by id desc limit 4").map((r) => ({
      ...r,
      covers: all<{ id: number }>(`select id from photos p where import_id = ? and ${good} order by quality desc limit 6`, r.id).map((x) => x.id),
      picks: one<{ n: number }>("select count(*) n from photos where import_id = ? and flag = 1", r.id)?.n ?? 0,
    }));
    const ready = all<{ id: number }>(`select id from photos p where ${good} and flag = 1 and posts = 0 order by quality desc limit 8`).map((r) => r.id);
    const readyCount = one<{ n: number }>(`select count(*) n from photos p where ${good} and flag = 1 and posts = 0`)?.n ?? 0;
    // Last year, the same week: the best photos.
    const d = new Date(now);
    const a = iso(now - 3 * DAY).slice(5), b = iso(now + 3 * DAY).slice(5);
    const onThisDay = all<{ id: number; y: string }>(
      `select id, substr(taken_at, 1, 4) y from photos p where ${good} and taken_at is not null and substr(taken_at, 1, 4) < ? and substr(taken_at, 6, 5) between ? and ? order by flag = 1 desc, rating desc, quality desc limit 8`,
      String(d.getFullYear()),
      a <= b ? a : "01-01",
      a <= b ? b : "12-31",
    );
    // Students not seen in photos for three weeks (and those never seen).
    const stale = iso(now - 21 * DAY);
    const notSeen = all<{ class_name: string | null; n: number }>(
      `select s.class_name, count(*) n from students s where s.kind = 'student' and s.left_on is null and s.can_post = 1 and not exists (
         select 1 from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and f.status in ('confirmed', 'manual') and p.missing = 0 and substr(coalesce(p.taken_at, p.event_date), 1, 10) >= ?)
       group by s.class_name order by n desc`,
      stale,
    );
    const students = one<{ n: number }>("select count(*) n from students where kind = 'student' and left_on is null")?.n ?? 0;
    const facesToConfirm = one<{ n: number }>("select count(*) n from faces where status = 'suggested'")?.n ?? 0;
    const facesUnknown = one<{ n: number }>("select count(*) n from faces f join photos p on p.id = f.photo_id where f.status = 'unknown' and p.missing = 0 and p.hidden = 0")?.n ?? 0;
    const toCull = one<{ n: number }>(`select count(*) n from photos p where ${good} and flag = 0 and rating = 0 and added_at > ?`, now - 7 * DAY)?.n ?? 0;
    const birthdays = all(
      "select id, name_en, name_ar, class_name, birthday from students where kind = 'student' and left_on is null and birthday is not null and substr(birthday, 6, 5) between ? and ? order by substr(birthday, 6, 5) limit 12",
      today.slice(5),
      iso(now + 6 * DAY).slice(5),
    );
    return {
      today,
      events,
      imports,
      ready,
      readyCount,
      onThisDay,
      notSeen: { total: notSeen.reduce((n, r) => n + r.n, 0), students, classes: notSeen.slice(0, 6) },
      occasions: upcomingOccasions(now),
      facesToConfirm,
      facesUnknown,
      toCull,
      birthdays,
    };
  }

  return { todayLocal: () => local() };
}
