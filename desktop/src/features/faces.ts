import { marks, q, type Api, type Ctx } from "./ctx";

// The Faces screens' questions: faces one by one with the whole photo
// beside them, which events still have faces to name, the "Not a face" bin,
// look-alikes and twins, class photos named row by row, and the teacher's
// "Is this …?" check on the phone (only the photo already on the website and
// where the face is; face data never leaves the Mac).
export function facesApi(ctx: Ctx): Api {
  const { one, all, run } = q(ctx);
  const PERSON = "id, name_en, name_ar, class_name, kind, portrait, can_post, left_on";

  function unknownFaces(f: { event?: string; className?: string; limit?: number } = {}) {
    const where = ["f.status = 'unknown'", "f.w > 0", "p.missing = 0", "p.hidden = 0"];
    const args: unknown[] = [];
    if (f.event) (where.push("p.event_key = ?"), args.push(f.event));
    if (f.className) (where.push("p.class_name = ?"), args.push(f.className));
    return all(
      `select f.id, f.photo_id, f.x, f.y, f.w, f.h, p.width, p.height, p.event_title, p.event_date, p.class_name from faces f join photos p on p.id = f.photo_id
       where ${where.join(" and ")} order by f.w * f.score desc limit ?`,
      ...args,
      f.limit ?? 300,
    );
  }

  // Events with faces nobody has named yet, most first.
  function eventsToName() {
    return all(
      `select p.event_key key, max(p.event_title) title, max(p.event_date) date, count(*) n from faces f join photos p on p.id = f.photo_id
       where f.status in ('unknown', 'suggested') and f.w > 0 and p.missing = 0 and p.hidden = 0 and p.event_key is not null
       group by p.event_key order by max(p.event_date) desc limit 80`,
    );
  }

  function faceDetail(id: number) {
    return one(
      `select f.id, f.photo_id, f.x, f.y, f.w, f.h, f.status, f.student_id, f.suggest_id, f.suggest_score, p.width, p.height, p.event_title, p.event_date, p.class_name, p.face_count
       from faces f join photos p on p.id = f.photo_id where f.id = ?`,
      id,
    );
  }

  function notFaces() {
    return all("select f.id, f.photo_id from faces f join photos p on p.id = f.photo_id where f.status = 'rejected' and p.missing = 0 order by f.id desc limit 600");
  }
  function putBack(ids: number[]) {
    if (!ids.length) return 0;
    run(`update faces set status = 'unknown' where status = 'rejected' and id in (${marks(ids.length)})`, ...ids);
    ctx.remember("unhide", `${ids.length}`, { kind: "sql", steps: [[`update faces set status = 'rejected' where id in (${marks(ids.length)})`, ids]] });
    ctx.push("faces");
    return ids.length;
  }

  function lookAlikes() {
    const pairs = ctx.engine()?.lookAlikes() ?? [];
    const person = (id: string) => one(`select ${PERSON}, (select f.id from faces f where f.student_id = students.id and f.status in ('confirmed', 'manual', 'portrait') order by f.auto, f.w * f.score desc limit 1) face from students where id = ?`, id);
    return pairs
      .map((p) => {
        const link = one<{ kind: string }>("select kind from links where ((a = ? and b = ?) or (a = ? and b = ?)) and kind in ('twin', 'sibling', 'lookalike', 'different')", p.a, p.b, p.b, p.a)?.kind ?? null;
        return { ...p, link, a: person(p.a), b: person(p.b) };
      })
      .filter((p) => p.a && p.b && p.link !== "different");
  }

  // Twins, siblings (any grade) and look-alikes. Twins and look-alikes are
  // never named automatically; siblings show on each other's page.
  function setLink(a: string, b: string, kind: "twin" | "sibling" | "lookalike" | "different" | null) {
    const before = all<{ a: string; b: string; kind: string }>("select a, b, kind from links where ((a = ? and b = ?) or (a = ? and b = ?)) and kind in ('twin', 'sibling', 'lookalike', 'different')", a, b, b, a);
    run("delete from links where ((a = ? and b = ?) or (a = ? and b = ?)) and kind in ('twin', 'sibling', 'lookalike', 'different')", a, b, b, a);
    if (kind) run("insert or ignore into links (a, b, kind) values (?, ?, ?)", a, b, kind);
    ctx.remember("student", `${a}:${b}:${kind ?? "none"}`, {
      kind: "sql",
      steps: [["delete from links where ((a = ? and b = ?) or (a = ? and b = ?)) and kind in ('twin', 'sibling', 'lookalike', 'different')", [a, b, b, a]], ...before.map((r) => ["insert or ignore into links (a, b, kind) values (?, ?, ?)", [r.a, r.b, r.kind]])],
    });
    ctx.push("students");
  }

  // A class photo: faces in rows, top to bottom and left to right, with the
  // names already known and the class list to choose from.
  function classPhoto(photoId: number) {
    const p = one<{ id: number; width: number; height: number; class_name: string | null; event_title: string | null }>("select id, width, height, class_name, event_title from photos where id = ?", photoId);
    if (!p) return null;
    const faces = all<{ id: number; x: number; y: number; w: number; h: number; status: string; student_id: string | null; suggest_id: string | null; suggest_score: number | null }>(
      "select id, x, y, w, h, status, student_id, suggest_id, suggest_score from faces where photo_id = ? and w > 0 and status not in ('rejected', 'background')",
      photoId,
    );
    // Rows: faces whose centres are within about one face height of each other.
    const sorted = [...faces].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
    const rows: (typeof faces)[] = [];
    for (const f of sorted) {
      const row = rows.at(-1);
      const cy = f.y + f.h / 2;
      if (row && Math.abs(cy - (row[0].y + row[0].h / 2)) < Math.max(row[0].h, f.h) * 0.6) row.push(f);
      else rows.push([f]);
    }
    rows.forEach((r) => r.sort((a, b) => a.x - b.x));
    const named = faces.map((f) => f.student_id).filter(Boolean) as string[];
    const counts = new Map<string, number>();
    for (const id of named) {
      const c = one<{ class_name: string | null }>("select class_name from students where id = ?", id)?.class_name;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const className = p.class_name ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const people = className ? all(`select ${PERSON} from students where class_name = ? and kind = 'student' and left_on is null order by coalesce(name_en, name_ar)`, className) : [];
    const names = new Map(all<{ id: string; name_en: string | null; name_ar: string | null }>(`select id, name_en, name_ar from students where id in (${marks(faces.length * 2 || 1)})`, ...(faces.length ? faces.flatMap((f) => [f.student_id ?? "", f.suggest_id ?? ""]) : [""])).map((s) => [s.id, s]));
    return {
      photo: p,
      className,
      people,
      rows: rows.map((r) => r.map((f) => ({ ...f, person: names.get(f.student_id ?? "") ?? null, guess: f.student_id ? null : names.get(f.suggest_id ?? "") ?? null }))),
    };
  }

  async function nameClassPhoto(items: { faceId: number; studentId: string | null }[]) {
    let n = 0;
    for (const it of items) {
      if (!it.studentId) continue;
      await ctx.call("confirmFaces", [it.faceId], it.studentId);
      n++;
    }
    return n;
  }

  // Photos with many faces (class and group photos), for class photo mode.
  function groupPhotos(className?: string) {
    return all(
      `select p.id, p.face_count, p.event_title, p.event_date, p.class_name,
         (select count(*) from faces f where f.photo_id = p.id and f.status in ('unknown', 'suggested')) unnamed
       from photos p where p.face_count >= 8 and p.missing = 0 and p.hidden = 0 ${className ? "and p.class_name = ?" : ""}
       order by unnamed desc, p.event_date desc limit 60`,
      ...(className ? [className] : []),
    );
  }

  // ---------- The teacher's check on the phone ----------
  // Suggestions for a class, only in photos already on the website, go to
  // the class teacher's phone as "Is this …?" with the photo and a box.
  async function sendChecks(className: string) {
    const rows = all<{ id: number; remote_id: string; x: number; y: number; w: number; h: number; suggest_id: string; suggest_score: number }>(
      `select f.id, p.remote_id, f.x, f.y, f.w, f.h, f.suggest_id, f.suggest_score from faces f join photos p on p.id = f.photo_id join students s on s.id = f.suggest_id
       where f.status = 'suggested' and p.remote_id is not null and p.missing = 0 and s.class_name = ? and f.suggest_score >= 0.5 order by f.suggest_score desc limit 200`,
      className,
    );
    if (!rows.length) return { sent: 0 };
    await ctx.appApi("faceChecks", { className, items: rows.map((r) => ({ macId: r.id, photo: r.remote_id, box: [r.x, r.y, r.w, r.h].map((v) => +v.toFixed(4)), student: r.suggest_id, score: +r.suggest_score.toFixed(2) })) });
    return { sent: rows.length };
  }
  async function pullChecks() {
    const r = await ctx.appApi("faceAnswers", {}).catch(() => null);
    const answers = (r?.answers ?? []) as { macId: number; student: string; ok: boolean; by?: string }[];
    let yes = 0, no = 0;
    for (const a of answers) {
      const f = one<{ status: string; suggest_id: string | null }>("select status, suggest_id from faces where id = ?", a.macId);
      if (!f || f.status !== "suggested" || f.suggest_id !== a.student) continue;
      if (a.ok) {
        await ctx.call("confirmFaces", [a.macId], a.student);
        yes++;
      } else {
        await ctx.call("rejectFaces", [a.macId]);
        no++;
      }
    }
    if (answers.length) await ctx.appApi("faceAnswersDone", { ids: answers.map((a) => a.macId) }).catch(() => null);
    return { yes, no };
  }

  return {
    unknownFaces: (f?: { event?: string; className?: string; limit?: number }) => unknownFaces(f),
    eventsToName: () => eventsToName(),
    faceDetail: (id: number) => faceDetail(id),
    notFaces: () => notFaces(),
    putBackFaces: (ids: number[]) => putBack(ids),
    lookAlikes: () => lookAlikes(),
    setLink: (a: string, b: string, kind: "twin" | "sibling" | "lookalike" | "different" | null) => setLink(a, b, kind),
    classPhoto: (id: number) => classPhoto(id),
    nameClassPhoto: (items: { faceId: number; studentId: string | null }[]) => nameClassPhoto(items),
    groupPhotos: (className?: string) => groupPhotos(className),
    sendFaceChecks: (className: string) => sendChecks(className),
    pullFaceChecks: () => pullChecks(),
  };
}
