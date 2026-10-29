import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { q, type Ctx } from "./ctx";

// What the website needs from this computer, sent every half hour while
// signed in: this computer (for the plan's computer limit), coverage counts
// per student (never faces), who is in each sent photo (student IDs, for
// "who's in this post"), and students' extra details. Face data never
// leaves the Mac.
export function webSync(ctx: Ctx) {
  const { one, all, run } = q(ctx);
  const s = () => ctx.settings().get() as Record<string, unknown>;

  function deviceId() {
    let id = s().deviceId as string | undefined;
    if (!id) {
      id = randomUUID();
      ctx.settings().set({ deviceId: id });
    }
    return id;
  }

  async function hello() {
    const r = await ctx.appApi("hello", { device: deviceId(), name: hostname().slice(0, 80), platform: process.platform });
    if (r?.error === "computer-limit") ctx.message(`computer-limit:${r.limit}`);
    return r;
  }

  async function coverage() {
    const r = await ctx.call("coverage", {});
    const rows = (r?.students ?? []) as { id: string; class_name: string | null; photos: number; good: number; focus: number; posted: number; last: string | null; ready: boolean; tooOften: boolean }[];
    if (rows.length)
      await ctx.appApi("coverage", {
        rows: rows.map((s) => ({ code: s.id, className: s.class_name, photos: s.photos, good: s.good, focus: s.focus, posts: s.posted, last: s.last, ready: s.ready, tooOften: s.tooOften })),
      });
  }

  // Only photos whose names changed since they were last sent.
  async function people() {
    const rows = all<{ id: number; remote_id: string; people: string | null; web_people: string | null }>(
      `select p.id, p.remote_id, p.web_people, (select group_concat(student_id) from (select distinct f.student_id from faces f where f.photo_id = p.id and f.status in ('confirmed', 'manual') and f.student_id is not null order by f.student_id)) people
       from photos p where p.remote_id is not null and p.missing = 0`,
    ).filter((r) => (r.people ?? "") !== (r.web_people ?? ""));
    for (let i = 0; i < rows.length; i += 400) {
      const part = rows.slice(i, i + 400);
      await ctx.appApi("people", { photos: part.map((r) => ({ id: r.remote_id, people: r.people ? r.people.split(",") : [] })) });
      for (const r of part) run("update photos set web_people = ? where id = ?", r.people ?? "", r.id);
    }
  }

  async function details() {
    const rows = all<Record<string, unknown>>("select id, kind, stage, grade, birthday, joined, left_on from students");
    const clubs = all<{ student_id: string; name: string }>("select gm.student_id, g.name from group_members gm join groups g on g.id = gm.group_id");
    const ach = all<{ student_id: string; title: string; on_date: string | null }>("select student_id, title, on_date from achievements");
    const teachers = all<{ class_name: string; name: string }>("select ct.class_name, coalesce(s.name_en, s.name_ar) name from class_teachers ct join students s on s.id = ct.teacher_id");
    const teacherOf = new Map(teachers.map((t) => [t.class_name, t.name]));
    const klass = new Map(all<{ id: string; class_name: string | null }>("select id, class_name from students").map((r) => [r.id, r.class_name]));
    const list = rows.map((r) => ({
      code: r.id,
      kind: r.kind ?? "student",
      stage: r.stage ?? null,
      grade: r.grade ?? null,
      birthday: r.birthday ?? null,
      joined_on: r.joined ?? null,
      left_on: r.left_on ?? null,
      clubs: clubs.filter((c) => c.student_id === r.id).map((c) => c.name),
      achievements: ach.filter((a) => a.student_id === r.id).map((a) => ({ title: a.title, on: a.on_date })),
      class_teacher: teacherOf.get(klass.get(r.id as string) ?? "") ?? null,
    }));
    for (let i = 0; i < list.length; i += 1000) await ctx.appApi("studentDetails", { students: list.slice(i, i + 1000) });
  }

  // Set-up steps done on this computer show as done on the website.
  async function setup() {
    const steps: Record<string, boolean> = {
      library: !!s().library,
      classLists: (one<{ n: number }>("select count(*) n from students where kind = 'student'")?.n ?? 0) > 0,
      firstImport: (one<{ n: number }>("select count(*) n from photos")?.n ?? 0) > 0,
      firstFaces: (one<{ n: number }>("select count(*) n from faces where status in ('confirmed', 'manual')")?.n ?? 0) >= 10,
    };
    const sent = (s().wizardSent as Record<string, boolean>) ?? {};
    for (const [k, v] of Object.entries(steps))
      if (v && !sent[k]) {
        await ctx.appApi("setupDone", { step: k }).catch(() => null);
        sent[k] = true;
      }
    ctx.settings().set({ wizardSent: sent });
    return steps;
  }

  async function once() {
    if (!s().userId) return;
    try {
      await hello();
      await setup();
      await coverage();
      await people();
      await details();
      await ctx.call("pullFaceChecks").catch(() => null);
    } catch (e) {
      ctx.log(`web sync: ${e instanceof Error ? e.message : e}`);
    }
  }

  let timer: NodeJS.Timeout | null = null;
  return {
    start() {
      setTimeout(() => void once(), 20_000);
      timer = setInterval(() => void once(), 30 * 60_000);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    now: once,
    setup,
    hello,
  };
}
