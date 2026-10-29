import { nameKey, nameMatches } from "../core/names";
import { likelyDuplicates, nextClass, schoolYear, stageFor } from "../core/students";
import { marks, q, type Api, type Ctx } from "./ctx";

// Students, teachers, staff and parents: the lists by Stage → Grade → Class,
// each person's page, bulk changes, clubs and teams, achievements, the class
// teacher, the new school year, and students entered twice.
export const MAIN_FACE = `coalesce(s.main_face, (select f.id from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and f.status in ('confirmed', 'manual', 'portrait') and p.missing = 0 order by f.auto, f.status = 'portrait' desc, f.w * f.score desc limit 1))`;
const NAMED = "f.status in ('confirmed', 'manual')";
const EDITABLE = ["name_en", "name_ar", "class_name", "stage", "grade", "gender", "birthday", "joined", "left_on", "left_why", "notes", "campus", "email", "phone", "kind", "can_post"] as const;
type Field = (typeof EDITABLE)[number];
const DAY = 86400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function studentsApi(ctx: Ctx): Api {
  const { one, all, run } = q(ctx);
  const s = () => ctx.settings().get() as Record<string, any>;

  // What's missing for each one: the warnings on cards and the "Missing info" chip.
  function missingOf(r: Record<string, any>) {
    const out: string[] = [];
    if (!r.name_ar) out.push("ar");
    if (!r.name_en) out.push("en");
    if (/^X[0-9a-f]{8}$|^X[0-9a-z]{6,}$/.test(r.id)) out.push("id");
    if (!r.face) out.push("face");
    if ((r.kind ?? "student") === "student" && !r.class_name) out.push("class");
    return out;
  }

  function tree() {
    const classes = all<{ stage: string | null; grade: string | null; class_name: string | null; n: number; zero: number }>(
      `select s.stage, s.grade, s.class_name, count(*) n,
         sum(case when not exists (select 1 from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and ${NAMED} and p.missing = 0) then 1 else 0 end) zero
       from students s where s.kind = 'student' and s.left_on is null group by s.stage, s.grade, s.class_name
       order by case s.stage when 'KG' then 0 when 'Primary' then 1 when 'Prep' then 2 when 'Secondary' then 3 else 4 end,
         case when s.grade like 'KG%' then 0 else 1 end, cast(replace(replace(s.grade, 'Grade ', ''), 'KG', '') as integer), s.class_name`,
    );
    const kinds = Object.fromEntries(all<{ kind: string; n: number }>("select kind, count(*) n from students where left_on is null group by kind").map((r) => [r.kind, r.n]));
    const left = one<{ n: number }>("select count(*) n from students where left_on is not null")?.n ?? 0;
    const groups = all("select g.id, g.name, g.kind, (select count(*) from group_members m where m.group_id = g.id) n from groups g order by g.kind, g.name");
    const teachers = Object.fromEntries(all<{ class_name: string; teacher_id: string; name: string }>("select ct.class_name, ct.teacher_id, coalesce(t.name_en, t.name_ar) name from class_teachers ct join students t on t.id = ct.teacher_id").map((r) => [r.class_name, { id: r.teacher_id, name: r.name }]));
    return { classes, kinds, left, groups, teachers, duplicates: duplicates().length };
  }

  type ListFilter = { className?: string; stage?: string; grade?: string; kind?: string; search?: string; chip?: string; group?: number; left?: boolean; ids?: string[] };
  function list(f: ListFilter = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.ids?.length) (where.push(`s.id in (${marks(f.ids.length)})`), args.push(...f.ids));
    if (f.left) where.push("s.left_on is not null");
    else if (!f.ids?.length) where.push("s.left_on is null");
    if (!f.left && !f.ids?.length) (where.push("s.kind = ?"), args.push(f.kind ?? "student"));
    if (f.className) (where.push("s.class_name = ?"), args.push(f.className));
    if (f.stage) (where.push("s.stage = ?"), args.push(f.stage));
    if (f.grade) (where.push("s.grade = ?"), args.push(f.grade));
    if (f.group) (where.push("s.id in (select student_id from group_members where group_id = ?)"), args.push(f.group));
    if (f.search) {
      const spelled = all<{ id: string; name_en: string | null; name_ar: string | null }>("select id, name_en, name_ar from students").filter((r) => nameMatches(f.search!, r.name_en, r.name_ar)).map((r) => r.id).slice(0, 500);
      where.push(`(s.id like ? or s.class_name like ?${spelled.length ? ` or s.id in (${marks(spelled.length)})` : ""})`);
      args.push(`%${f.search}%`, `%${f.search}%`, ...spelled);
    }
    const rows = all<Record<string, any>>(
      `select s.id, s.name_en, s.name_ar, s.class_name, s.stage, s.grade, s.kind, s.can_post, s.birthday, s.joined, s.left_on, s.left_why, s.portrait, ${MAIN_FACE} face,
         (select count(distinct f.photo_id) from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and ${NAMED} and p.missing = 0) photos,
         (select max(substr(coalesce(p.taken_at, p.event_date), 1, 10)) from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and ${NAMED} and p.missing = 0) last_seen,
         (select count(*) from faces f where f.suggest_id = s.id and f.status = 'suggested') suggested,
         (select group_concat(g.name, ', ') from group_members m join groups g on g.id = m.group_id where m.student_id = s.id) clubs
       from students s where ${where.join(" and ") || "1"} order by s.class_name, coalesce(s.name_en, s.name_ar) limit 4000`,
      ...args,
    ).map((r) => ({ ...r, missing: missingOf(r) }));
    const stale = iso(Date.now() - 21 * DAY);
    const month = iso(Date.now()).slice(5, 7);
    const chip: Record<string, (r: Record<string, any>) => boolean> = {
      nophotos: (r) => r.photos === 0,
      notseen: (r) => !r.last_seen || r.last_seen < stale,
      cantappear: (r) => !r.can_post,
      missing: (r) => r.missing.length > 0,
      birthday: (r) => !!r.birthday && r.birthday.slice(5, 7) === month,
      review: (r) => r.suggested > 0,
    };
    return f.chip && chip[f.chip] ? rows.filter(chip[f.chip]) : rows;
  }

  // One person's page: their photos by event as a timeline, how often they
  // appear and in posts, face examples, parents, siblings, years at school,
  // clubs, achievements and notes.
  function profile(id: string) {
    const st = one<Record<string, any>>(`select s.*, ${MAIN_FACE} face from students s where s.id = ?`, id);
    if (!st) return null;
    const events = all<{ event_key: string | null; event_title: string | null; event_date: string | null; year: string | null; term: string | null; n: number; ids: string }>(
      `select p.event_key, max(p.event_title) event_title, max(p.event_date) event_date, max(p.year) year, max(p.term) term, count(distinct p.id) n,
         (select group_concat(id) from (select distinct p2.id from faces f2 join photos p2 on p2.id = f2.photo_id where f2.student_id = ? and f2.status in ('confirmed', 'manual') and p2.missing = 0 and coalesce(p2.event_key, '') = coalesce(p.event_key, '') order by p2.rating desc, p2.flag = 1 desc, p2.taken_at limit 8)) ids
       from faces f join photos p on p.id = f.photo_id where f.student_id = ? and ${NAMED} and p.missing = 0
       group by p.event_key order by max(coalesce(p.event_date, p.taken_at)) desc limit 120`,
      id,
      id,
    ).map((e) => ({ ...e, ids: (e.ids ?? "").split(",").filter(Boolean).map(Number) }));
    const counts = one<{ photos: number; posted: number; last: string | null; first: string | null }>(
      `select count(distinct p.id) photos, count(distinct case when p.posts > 0 then p.id end) posted, max(substr(coalesce(p.taken_at, p.event_date), 1, 10)) last, min(substr(coalesce(p.taken_at, p.event_date), 1, 10)) first
       from faces f join photos p on p.id = f.photo_id where f.student_id = ? and ${NAMED} and p.missing = 0`,
      id,
    );
    const person = (sql: string, ...a: unknown[]) => all(`select s.id, s.name_en, s.name_ar, s.class_name, s.kind, s.can_post, ${MAIN_FACE} face, x.kind link from links x join students s on ${sql}`, ...a);
    const parents = person("s.id = x.a where x.b = ? and x.kind = 'parent'", id);
    const parentOf = person("s.id = x.b where x.a = ? and x.kind = 'parent'", id);
    const siblings = person("s.id = case when x.a = ? then x.b else x.a end where (x.a = ? or x.b = ?) and x.kind in ('sibling', 'twin')", id, id, id);
    // Brothers and sisters found through a shared parent, too.
    const viaParents = parents.length
      ? all(`select distinct s.id, s.name_en, s.name_ar, s.class_name, s.kind, s.can_post, ${MAIN_FACE} face, 'sibling' link from links x join students s on s.id = x.b where x.kind = 'parent' and x.a in (${marks(parents.length)}) and x.b <> ?`, ...parents.map((p: any) => p.id), id)
      : [];
    const sib = [...siblings, ...viaParents.filter((v: any) => !siblings.some((x: any) => x.id === v.id))];
    const history = all("select year, class_name, campus from school_history where student_id = ? order by year", id);
    const groups = all("select g.id, g.name, g.kind from group_members m join groups g on g.id = m.group_id where m.student_id = ? order by g.name", id);
    const achievements = all("select id, title, on_date from achievements where student_id = ? order by coalesce(on_date, '') desc, id desc", id);
    const teacher = st.class_name ? one(`select t.id, t.name_en, t.name_ar from class_teachers ct join students t on t.id = ct.teacher_id where ct.class_name = ?`, st.class_name) : null;
    const teaches = all("select class_name from class_teachers where teacher_id = ? order by class_name", id).map((r: any) => r.class_name);
    const examples = all("select f.id, f.photo_id from faces f where f.student_id = ? and f.status in ('confirmed', 'manual', 'portrait') and f.auto = 0 order by f.w * f.score desc limit 24", id);
    return { student: { ...st, missing: missingOf(st) }, events, counts, parents, parentOf, siblings: sib, history, groups, achievements, teacher, teaches, examples, year: schoolYear() };
  }

  function snapshot(ids: string[]) {
    return all<Record<string, unknown>>(`select id, ${EDITABLE.join(", ")} from students where id in (${marks(ids.length)})`, ...ids);
  }
  function restoreSteps(rows: Record<string, unknown>[]) {
    return rows.map((r) => [`update students set ${EDITABLE.map((k) => `${k} = ?`).join(", ")} where id = ?`, [...EDITABLE.map((k) => r[k] ?? null), r.id]]);
  }

  function save(id: string, fields: Partial<Record<Field, unknown>>) {
    const keys = Object.keys(fields).filter((k) => (EDITABLE as readonly string[]).includes(k)) as Field[];
    if (!keys.length) return;
    const before = snapshot([id]);
    if (keys.includes("grade") && !keys.includes("stage")) (fields.stage = stageFor(String(fields.grade ?? "")) ?? before[0]?.stage ?? null), keys.push("stage");
    run(`update students set ${keys.map((k) => `${k} = ?`).join(", ")} where id = ?`, ...keys.map((k) => (k === "can_post" ? (fields[k] ? 1 : 0) : fields[k] === "" ? null : fields[k] ?? null)), id);
    ctx.remember("student", id, { kind: "sql", steps: restoreSteps(before) });
    if (keys.includes("can_post")) ctx.call("setCanPost", id, !!fields.can_post);
    ctx.push("students");
  }

  async function bulk(ids: string[], op: string, value?: unknown) {
    if (!ids.length) return 0;
    const before = snapshot(ids);
    const steps: unknown[] = restoreSteps(before);
    const where = `id in (${marks(ids.length)})`;
    switch (op) {
      case "class": {
        const cls = String(value ?? "").trim() || null;
        const grade = cls ? (/^KG\d/i.exec(cls)?.[0].toUpperCase() ?? (/^\d+/.exec(cls) ? `Grade ${Number(/^\d+/.exec(cls)![0])}` : null)) : null;
        run(`update students set class_name = ?, grade = coalesce(?, grade), stage = coalesce(?, stage) where ${where}`, cls, grade, stageFor(grade), ...ids);
        break;
      }
      case "left":
        run(`update students set left_on = ?, left_why = ? where ${where} and left_on is null`, iso(Date.now()), value ?? "left", ...ids);
        break;
      case "back":
        run(`update students set left_on = null, left_why = null where ${where}`, ...ids);
        break;
      case "kind":
        run(`update students set kind = ? where ${where}`, String(value), ...ids);
        break;
      case "canPost":
        for (const id of ids) await ctx.call("setCanPost", id, !!value);
        break;
      case "group": {
        const g = Number(value);
        for (const id of ids) run("insert or ignore into group_members (group_id, student_id) values (?, ?)", g, id);
        steps.push([`delete from group_members where group_id = ? and student_id in (${marks(ids.length)})`, [g, ...ids]]);
        break;
      }
      case "ungroup": {
        const g = Number(value);
        run(`delete from group_members where group_id = ? and student_id in (${marks(ids.length)})`, g, ...ids);
        for (const id of ids) steps.push(["insert or ignore into group_members (group_id, student_id) values (?, ?)", [g, id]]);
        break;
      }
      default:
        throw new Error("not-supported");
    }
    ctx.remember("students", `${op}:${ids.length}`, { kind: "sql", steps });
    ctx.push("students");
    return ids.length;
  }

  // Parents, brothers and sisters (any grade).
  function link(a: string, b: string, kind: "parent" | "sibling" | "twin", on: boolean) {
    if (on) run("insert or ignore into links (a, b, kind) values (?, ?, ?)", a, b, kind);
    else run("delete from links where ((a = ? and b = ?) or (a = ? and b = ?)) and kind = ?", a, b, b, a, kind);
    ctx.remember("student", `${a}:${b}:${kind}`, { kind: "sql", steps: [on ? ["delete from links where a = ? and b = ? and kind = ?", [a, b, kind]] : ["insert or ignore into links (a, b, kind) values (?, ?, ?)", [a, b, kind]]] });
    ctx.push("students");
  }

  function addAchievement(id: string, title: string, on: string | null) {
    const r = run("insert into achievements (student_id, title, on_date, added_at) values (?, ?, ?, ?)", id, title.trim().slice(0, 140), on || null, Date.now());
    ctx.remember("student", `award:${id}`, { kind: "sql", steps: [["delete from achievements where id = ?", [Number(r.lastInsertRowid)]]] });
    ctx.push("students");
  }
  function removeAchievement(aid: number) {
    const a = one<Record<string, unknown>>("select * from achievements where id = ?", aid);
    if (!a) return;
    run("delete from achievements where id = ?", aid);
    ctx.remember("student", `award:${a.student_id}`, { kind: "sql", steps: [["insert into achievements (id, student_id, title, on_date, added_at) values (?, ?, ?, ?, ?)", [a.id, a.student_id, a.title, a.on_date, a.added_at]]] });
    ctx.push("students");
  }

  // Clubs and teams (the football team, the choir) are groups of students.
  function saveGroup(g: { id?: number; name: string; kind?: string; teacher_id?: string | null }) {
    const name = g.name.trim().slice(0, 80);
    if (!name) return null;
    if (g.id) {
      run("update groups set name = ?, kind = coalesce(?, kind), teacher_id = ? where id = ?", name, g.kind ?? null, g.teacher_id ?? null, g.id);
      ctx.push("students");
      return g.id;
    }
    const r = run("insert into groups (name, kind, teacher_id, added_at) values (?, ?, ?, ?)", name, g.kind ?? "club", g.teacher_id ?? null, Date.now());
    ctx.push("students");
    return Number(r.lastInsertRowid);
  }
  function deleteGroup(id: number) {
    const g = one<Record<string, unknown>>("select * from groups where id = ?", id);
    if (!g) return;
    const members = all<{ student_id: string }>("select student_id from group_members where group_id = ?", id);
    run("delete from groups where id = ?", id);
    ctx.remember("students", `group:${g.name}`, {
      kind: "sql",
      steps: [["insert into groups (id, name, kind, teacher_id, added_at) values (?, ?, ?, ?, ?)", [g.id, g.name, g.kind, g.teacher_id, g.added_at]], ...members.map((m) => ["insert or ignore into group_members (group_id, student_id) values (?, ?)", [id, m.student_id]])],
    });
    ctx.push("students");
  }

  function setClassTeacher(className: string, teacherId: string | null) {
    const before = one<{ teacher_id: string | null }>("select teacher_id from class_teachers where class_name = ?", className);
    if (teacherId) run("insert into class_teachers (class_name, teacher_id) values (?, ?) on conflict (class_name) do update set teacher_id = excluded.teacher_id", className, teacherId);
    else run("delete from class_teachers where class_name = ?", className);
    ctx.remember("student", `teacher:${className}`, {
      kind: "sql",
      steps: [before ? ["insert into class_teachers (class_name, teacher_id) values (?, ?) on conflict (class_name) do update set teacher_id = excluded.teacher_id", [className, before.teacher_id]] : ["delete from class_teachers where class_name = ?", [className]]],
    });
    ctx.push("students");
  }

  // ---------- New school year ----------
  function promotePlan() {
    const classes = all<{ class_name: string | null; grade: string | null; n: number }>(
      `select class_name, grade, count(*) n from students where kind = 'student' and left_on is null group by class_name, grade
       order by case when grade like 'KG%' then 0 else 1 end, cast(replace(replace(grade, 'Grade ', ''), 'KG', '') as integer), class_name`,
    );
    const done = one<{ n: number }>("select count(*) n from school_history where year = ?", schoolYear())?.n ?? 0;
    return { year: schoolYear(), next: nextYear(schoolYear()), alreadyDone: done > 0, classes: classes.map((c) => ({ from: c.class_name, n: c.n, ...nextClass(c.class_name, c.grade) })) };
  }
  const nextYear = (y: string) => y.replace(/(\d{4})-(\d{4})/, (_, a, b) => `${Number(a) + 1}-${Number(b) + 1}`);

  // Each student's year is kept in their school history, then everyone moves
  // up; those graduating are kept, as left (graduated), for their books.
  function promote(plan: { from: string | null; to: string | null; graduates: boolean }[]) {
    const year = schoolYear();
    const ids = all<{ id: string }>("select id from students where kind = 'student' and left_on is null").map((r) => r.id);
    const before = snapshot(ids);
    const steps: unknown[] = [...restoreSteps(before), ["delete from school_history where year = ? and student_id in (" + marks(ids.length || 1) + ")", [year, ...(ids.length ? ids : [""])]]];
    const today = iso(Date.now());
    ctx.db().exec("begin");
    try {
      run(`insert or ignore into school_history (student_id, year, class_name, campus) select id, ?, class_name, campus from students where kind = 'student' and left_on is null`, year);
      for (const p of plan) {
        const match = p.from === null ? "class_name is null" : "class_name = ?";
        const a = p.from === null ? [] : [p.from];
        if (p.graduates) run(`update students set left_on = ?, left_why = 'graduated' where kind = 'student' and left_on is null and ${match}`, today, ...a);
        else if (p.to !== p.from) {
          const grade = /^KG\d/i.exec(p.to ?? "")?.[0].toUpperCase() ?? (/^\d+/.exec(p.to ?? "") ? `Grade ${Number(/^\d+/.exec(p.to!)![0])}` : null);
          run(`update students set class_name = ?, grade = coalesce(?, grade), stage = coalesce(?, stage) where kind = 'student' and left_on is null and ${match}`, p.to, grade, stageFor(grade), ...a);
        }
      }
      ctx.db().exec("commit");
    } catch (e) {
      ctx.db().exec("rollback");
      throw e;
    }
    ctx.remember("students", `newyear:${year}`, { kind: "sql", steps });
    ctx.push("students");
    return { moved: ids.length, graduated: plan.filter((p) => p.graduates).length };
  }

  // ---------- Entered twice ----------
  function duplicates() {
    const rows = all<{ id: string; name_en: string | null; name_ar: string | null; class_name: string | null; kind: string | null }>("select id, name_en, name_ar, class_name, kind from students");
    const different = new Set(all<{ a: string; b: string }>("select a, b from links where kind = 'notsame'").map((r) => [r.a, r.b].sort().join("|")));
    return likelyDuplicates(rows, nameKey)
      .filter(([a, b]) => !different.has([a.id, b.id].sort().join("|")))
      .map(([a, b]) => [a, b].map((r) => ({ ...r, ...one(`select ${MAIN_FACE} face, (select count(*) from faces f where f.student_id = s.id and ${NAMED}) faces from students s where s.id = ?`, r.id) })));
  }
  function notSame(a: string, b: string) {
    run("insert or ignore into links (a, b, kind) values (?, ?, 'notsame')", a, b);
    ctx.push("students");
  }
  // Everything the second one has moves to the first, then the second goes.
  function merge(keep: string, drop: string) {
    if (keep === drop) return;
    const d = one<Record<string, unknown>>("select * from students where id = ?", drop);
    if (!d) return;
    ctx.db().exec("begin");
    try {
      for (const k of ["name_en", "name_ar", "gender", "stage", "grade", "class_name", "portrait", "birthday", "joined", "notes", "campus", "email", "phone", "remote_id"])
        run(`update students set ${k} = coalesce(${k}, ?) where id = ?`, d[k] ?? null, keep);
      run("update students set can_post = min(can_post, ?) where id = ?", d.can_post ?? 1, keep);
      run("update faces set student_id = ? where student_id = ?", keep, drop);
      run("update faces set suggest_id = ? where suggest_id = ?", keep, drop);
      run("insert or ignore into links (a, b, kind) select ?, b, kind from links where a = ? and b <> ?", keep, drop, keep);
      run("insert or ignore into links (a, b, kind) select a, ?, kind from links where b = ? and a <> ?", keep, drop, keep);
      run("insert or ignore into group_members (group_id, student_id) select group_id, ? from group_members where student_id = ?", keep, drop);
      run("update achievements set student_id = ? where student_id = ?", keep, drop);
      run("insert or ignore into school_history (student_id, year, class_name, campus) select ?, year, class_name, campus from school_history where student_id = ?", keep, drop);
      run("update class_teachers set teacher_id = ? where teacher_id = ?", keep, drop);
      run("delete from students where id = ?", drop);
      ctx.db().exec("commit");
    } catch (e) {
      ctx.db().exec("rollback");
      throw e;
    }
    ctx.remember("student", `merge:${drop}>${keep}`, null);
    ctx.engine()?.queueFaceScan?.();
    ctx.push("students");
  }

  // Birthdays coming up (for birthday post ideas) and achievements (for
  // "student of the month" posts).
  function birthdays(days = 30) {
    const now = Date.now();
    const from = iso(now).slice(5);
    const to = iso(now + days * DAY).slice(5);
    const wrap = from > to;
    return all(
      `select s.id, s.name_en, s.name_ar, s.class_name, s.birthday, s.can_post, ${MAIN_FACE} face from students s where s.left_on is null and s.birthday is not null
       and ${wrap ? "(substr(s.birthday, 6, 5) >= ? or substr(s.birthday, 6, 5) <= ?)" : "substr(s.birthday, 6, 5) between ? and ?"} order by (substr(s.birthday, 6, 5) < ?), substr(s.birthday, 6, 5) limit 200`,
      from,
      to,
      from,
    );
  }
  function recentAchievements(limit = 30) {
    return all(`select a.id, a.title, a.on_date, s.id student_id, s.name_en, s.name_ar, s.class_name, s.can_post from achievements a join students s on s.id = a.student_id order by coalesce(a.on_date, '') desc, a.id desc limit ?`, limit);
  }

  return {
    studentTree: () => tree(),
    studentList: (f?: ListFilter) => list(f),
    profile: (id: string) => profile(id),
    saveStudent: (id: string, fields: Partial<Record<Field, unknown>>) => save(id, fields),
    bulkStudents: (ids: string[], op: string, value?: unknown) => bulk(ids, op, value),
    linkPeople: (a: string, b: string, kind: "parent" | "sibling" | "twin", on: boolean) => link(a, b, kind, on),
    addAchievement: (id: string, title: string, on: string | null) => addAchievement(id, title, on),
    removeAchievement: (id: number) => removeAchievement(id),
    saveGroup: (g: { id?: number; name: string; kind?: string; teacher_id?: string | null }) => saveGroup(g),
    deleteGroup: (id: number) => deleteGroup(id),
    setClassTeacher: (className: string, teacherId: string | null) => setClassTeacher(className, teacherId),
    promotePlan: () => promotePlan(),
    promote: (plan: { from: string | null; to: string | null; graduates: boolean }[]) => promote(plan),
    studentDuplicates: () => duplicates(),
    notSame: (a: string, b: string) => notSame(a, b),
    mergeStudents: (keep: string, drop: string) => merge(keep, drop),
    birthdays: (days?: number) => birthdays(days),
    recentAchievements: (limit?: number) => recentAchievements(limit),
    schoolYear: () => schoolYear(),
  };
}
