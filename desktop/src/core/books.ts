import type { Db } from "./db";

// Yearbooks laid out on this Mac: a book for a grade or for one class, a
// book for each student, and graduation books (KG2, Grade 12). The Mac makes
// a first draft (pages for classes, teachers, staff, trips, sports, firsts
// and the year's events, the fairest choice of photos); then every page can
// be changed, locked when approved, and the book saved with versions. It
// prints at 300 dpi from the originals, A4, A5 or square, with bleed and crop
// marks, and as a flipbook. Students who can't appear are left out or
// blurred, per book. Students who left mid-year can be kept in.

export type BookKind = "grade" | "class" | "student" | "graduation";
export type PageType = "cover" | "welcome" | "class" | "teachers" | "staff" | "event" | "trips" | "sports" | "firsts" | "student" | "year" | "text" | "end";
export type Layout = "auto" | "hero" | "grid" | "collage" | "single";
export type Page = {
  id: string;
  type: PageType;
  title: string;
  titleAr?: string;
  text?: string;
  textAr?: string;
  layout: Layout;
  photos: number[];
  students?: string[];
  className?: string | null;
  event?: string | null;
  date?: string | null;
  year?: string | null;
  locked?: boolean;
};
export type BookSpec = {
  kind: BookKind;
  title?: string;
  year: string;
  grade?: string | null;
  className?: string | null;
  studentId?: string | null;
  school: string;
  language: "ar" | "en" | "both";
  theme?: "classic" | "bold" | "soft" | "night";
  size?: "A4" | "A5" | "square";
  bleed?: boolean;
  cropMarks?: boolean;
  cantAppear?: "leave" | "blur";
  leavers?: boolean;
  accent?: string;
  logo?: string | null;
  cover?: { style: "photo" | "faces" | "plain"; photo?: number | null; subtitle?: string };
};

type Student = { id: string; name_en: string | null; name_ar: string | null; class_name: string | null; grade: string | null; face: number | null; portrait: string | null; can_post: number; since: string | null; left_on: string | null; kind: string };
type Photo = { id: number; event_key: string | null; event_title: string | null; event_date: string | null; category: string | null; quality: number | null; width: number | null; height: number | null };

const MAIN_FACE = `coalesce(s.main_face, (select f.id from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and f.status in ('confirmed', 'manual', 'portrait') and p.missing = 0 order by f.auto, f.status = 'portrait' desc, f.w * f.score desc limit 1))`;
// Photos put into the "Yearbook picks" album (from a post or by hand) lead.
export const YEARBOOK_ALBUMS = ["Yearbook picks", "اختيارات الكتاب السنوي"];
const PICKED = `exists (select 1 from album_photos ap join albums a on a.id = ap.album_id where ap.photo_id = p.id and a.name in ('${YEARBOOK_ALBUMS.join("', '")}'))`;
const USABLE = "p.missing = 0 and p.pair_of is null and p.dup_of is null and p.flag >= 0 and p.hidden = 0 and coalesce(p.problems, '') = ''";
const NOPOST = "exists (select 1 from faces f2 join students s2 on s2.id = f2.student_id where f2.photo_id = p.id and f2.status in ('confirmed', 'manual') and s2.can_post = 0)";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
let seq = 0;
const pid = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

// The school year's first day (September), for students who left mid-year.
const yearStart = (year: string) => `${/^(\d{4})/.exec(year)?.[1] ?? "1970"}-09-01`;

function studentsIn(db: Db, spec: BookSpec, className: string) {
  const since = `coalesce(s.joined, (select min(h.year) from school_history h where h.student_id = s.id))`;
  const past = (db.prepare("select count(*) n from school_history where year = ?").get(spec.year) as { n: number }).n > 0 && !isCurrent(db, spec.year);
  const rows = past
    ? (db.prepare(`select s.id, s.name_en, s.name_ar, h.class_name, s.grade, s.portrait, s.can_post, s.left_on, s.kind, ${since} since, ${MAIN_FACE} face from school_history h join students s on s.id = h.student_id where h.year = ? and h.class_name = ? order by coalesce(s.name_en, s.name_ar)`).all(spec.year, className) as Student[])
    : (db
        .prepare(`select s.id, s.name_en, s.name_ar, s.class_name, s.grade, s.portrait, s.can_post, s.left_on, s.kind, ${since} since, ${MAIN_FACE} face from students s where s.kind = 'student' and s.class_name = ? and (s.left_on is null ${spec.leavers ? "or s.left_on >= ?" : ""}) order by coalesce(s.name_en, s.name_ar)`)
        .all(className, ...(spec.leavers ? [yearStart(spec.year)] : [])) as Student[]);
  return rows;
}
function isCurrent(db: Db, year: string) {
  const latest = (db.prepare("select max(year) y from photos where year is not null").get() as { y: string | null }).y;
  return !latest || year >= latest;
}
function classesOf(db: Db, spec: BookSpec) {
  if (spec.kind === "class" || spec.kind === "student" || spec.kind === "graduation") {
    if (spec.className) return [spec.className];
    const s = spec.studentId ? (db.prepare("select class_name from students where id = ?").get(spec.studentId) as { class_name: string | null } | undefined) : undefined;
    return s?.class_name ? [s.class_name] : [];
  }
  const hist = (db.prepare("select distinct h.class_name from school_history h join students s on s.id = h.student_id where h.year = ? and s.grade = ? and h.class_name is not null").all(spec.year, spec.grade ?? "") as { class_name: string }[]).map((r) => r.class_name);
  const now = (db.prepare("select distinct class_name from students where grade = ? and class_name is not null and kind = 'student' order by class_name").all(spec.grade ?? "") as { class_name: string }[]).map((r) => r.class_name);
  return [...new Set(isCurrent(db, spec.year) ? now : hist.length ? hist : now)].sort();
}

// Photos that may go in this book: from its year and classes (or the whole
// school), good, and without students who can't appear unless the book
// blurs them.
function candidates(db: Db, spec: BookSpec, classes: string[], extra = "", args: string[] = []) {
  const cls = classes.length ? `and (p.class_name in (${classes.map(() => "?").join(",")}) or p.class_name is null or exists (select 1 from faces f join students s on s.id = f.student_id where f.photo_id = p.id and f.status in ('confirmed', 'manual') and s.class_name in (${classes.map(() => "?").join(",")})))` : "";
  return db
    .prepare(
      `select p.id, p.event_key, p.event_title, p.event_date, p.category, p.quality, p.width, p.height from photos p
       where ${USABLE} and p.year = ? ${cls} ${spec.cantAppear === "blur" ? "" : `and not ${NOPOST}`} ${extra}
       order by p.event_date, ${PICKED} desc, p.flag desc, p.rating desc, p.quality desc limit 6000`,
    )
    .all(spec.year, ...classes, ...classes, ...args) as Photo[];
}

// Fair choice: each photo is scored by quality, less for students already
// shown often in the book, more for students not shown yet.
function fairPick(db: Db, pool: Photo[], n: number, used: Map<string, number>) {
  const people = new Map<number, string[]>();
  const q = db.prepare("select student_id from faces where photo_id = ? and status in ('confirmed', 'manual') and student_id is not null");
  for (const p of pool) people.set(p.id, (q.all(p.id) as { student_id: string }[]).map((r) => r.student_id));
  const chosen: Photo[] = [];
  const left = [...pool];
  while (chosen.length < n && left.length) {
    let best = 0, score = -Infinity;
    left.forEach((p, i) => {
      const who = people.get(p.id) ?? [];
      const s = (p.quality ?? 0.5) * 2 + who.reduce((a, id) => a + ((used.get(id) ?? 0) === 0 ? 1 : -0.4 * (used.get(id) ?? 0)), 0) / Math.max(1, Math.sqrt(who.length));
      if (s > score) (score = s), (best = i);
    });
    const [p] = left.splice(best, 1);
    chosen.push(p);
    for (const id of people.get(p.id) ?? []) used.set(id, (used.get(id) ?? 0) + 1);
  }
  return chosen.sort((a, b) => (a.event_date ?? "").localeCompare(b.event_date ?? ""));
}

const KIND_OF = (title: string | null, category: string | null): PageType => {
  const t = (title ?? "").toLowerCase();
  if (/first day|first week|أول يوم|اليوم الأول|first/.test(t)) return "firsts";
  if (category === "trips" || /trip|رحلة|visit|زيارة/.test(t)) return "trips";
  if (category === "sports" || /sport|match|tournament|رياض|مباراة|بطولة/.test(t)) return "sports";
  return "event";
};

// The first draft. Locked pages from an earlier draft are kept as they are.
export function draftPages(db: Db, spec: BookSpec, keep: Page[] = []): Page[] {
  const T = (en: string, ar: string) => ({ title: en, titleAr: ar });
  const classes = classesOf(db, spec);
  const used = new Map<string, number>();
  const pages: Page[] = [];
  const locked = keep.filter((p) => p.locked);
  const lockedPhotos = new Set(locked.flatMap((p) => p.photos));
  const add = (p: Omit<Page, "id">) => {
    const same = locked.find((l) => l.type === p.type && (l.className ?? null) === (p.className ?? null) && (l.event ?? null) === (p.event ?? null) && (l.year ?? null) === (p.year ?? null));
    pages.push(same ?? { id: pid(), ...p });
  };
  const student = spec.studentId ? (db.prepare(`select s.id, s.name_en, s.name_ar, s.class_name, s.grade, s.portrait, s.can_post, s.left_on, s.kind, s.joined since, ${MAIN_FACE} face from students s where s.id = ?`).get(spec.studentId) as Student | undefined) : undefined;
  const best = candidates(db, spec, classes).filter((p) => !lockedPhotos.has(p.id));
  add({ type: "cover", ...T(spec.title || "Yearbook", spec.title || "الكتاب السنوي"), layout: "hero", photos: spec.cover?.photo ? [spec.cover.photo] : best.slice(0, 1).map((p) => p.id), students: student ? [student.id] : [] });

  if (spec.kind === "grade" || spec.kind === "class") {
    add({ type: "welcome", ...T("A word from the principal", "كلمة المدير"), layout: "single", photos: [] });
    for (const c of classes) add({ type: "class", ...T(`Class ${c}`, `فصل ${c}`), layout: "grid", photos: [], className: c, students: studentsIn(db, spec, c).map((s) => s.id) });
    const teachers = (db.prepare(`select distinct s.id from students s left join class_teachers ct on ct.teacher_id = s.id where s.kind = 'teacher' and s.left_on is null ${classes.length ? `and (ct.class_name in (${classes.map(() => "?").join(",")}) or ct.class_name is null)` : ""}`).all(...classes) as { id: string }[]).map((r) => r.id);
    if (teachers.length) add({ type: "teachers", ...T("Our teachers", "معلمونا"), layout: "grid", photos: [], students: teachers });
    const staff = (db.prepare("select id from students where kind = 'staff' and left_on is null").all() as { id: string }[]).map((r) => r.id);
    if (staff.length && spec.kind === "grade") add({ type: "staff", ...T("The people who keep our school running", "من يجعلون مدرستنا تعمل"), layout: "grid", photos: [], students: staff });
  }

  if (spec.kind === "graduation" && student) {
    // Only the years they were here, from the year they joined.
    const years = (db.prepare(
      `select distinct p.year from faces f join photos p on p.id = f.photo_id where f.student_id = ? and f.status in ('confirmed', 'manual') and ${USABLE} and p.year is not null and p.year >= coalesce((select min(year) from school_history where student_id = ?), '') order by p.year`,
    ).all(student.id, student.id) as { year: string }[]).map((y) => y.year);
    for (const y of years) {
      const mine = db.prepare(`select distinct p.id, p.event_key, p.event_title, p.event_date, p.category, p.quality, p.width, p.height from faces f join photos p on p.id = f.photo_id where f.student_id = ? and f.status in ('confirmed', 'manual') and ${USABLE} and p.year = ? order by ${PICKED} desc, p.flag desc, p.rating desc, p.quality desc limit 6`).all(student.id, y) as Photo[];
      if (mine.length) add({ type: "year", ...T(y, y), layout: "auto", photos: mine.map((p) => p.id), year: y });
    }
  }
  if (spec.kind === "student" && student) {
    const mine = db.prepare(`select distinct p.id from faces f join photos p on p.id = f.photo_id where f.student_id = ? and f.status in ('confirmed', 'manual') and ${USABLE} and p.year = ? order by ${PICKED} desc, p.flag desc, p.rating desc, p.quality desc limit 12`).all(student.id, spec.year) as { id: number }[];
    for (let i = 0; i < mine.length; i += 6) add({ type: "student", ...T("My year", "عامي"), layout: "auto", photos: mine.slice(i, i + 6).map((p) => p.id), students: [student.id] });
  }
  if ((spec.kind === "student" || spec.kind === "graduation") && classes[0]) add({ type: "class", ...T(`Class ${classes[0]}`, `فصل ${classes[0]}`), layout: "grid", photos: [], className: classes[0], students: studentsIn(db, spec, classes[0]).map((s) => s.id) });

  // The year's events, grouped into trips, sports, firsts and the rest.
  const byEvent = new Map<string, Photo[]>();
  for (const p of best) if (p.event_key) (byEvent.get(p.event_key) ?? byEvent.set(p.event_key, []).get(p.event_key)!).push(p);
  const perEvent = spec.kind === "student" ? 4 : 6;
  for (const [key, list] of byEvent) {
    const type = KIND_OF(list[0].event_title, list[0].category);
    const chosen = fairPick(db, list, perEvent, used);
    if (chosen.length) add({ type, title: list[0].event_title ?? "", titleAr: list[0].event_title ?? "", layout: "auto", photos: chosen.map((p) => p.id), event: key, date: list[0].event_date });
  }
  const order: PageType[] = ["cover", "welcome", "firsts", "class", "teachers", "staff", "student", "year", "event", "trips", "sports", "text", "end"];
  pages.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || (a.date ?? "").localeCompare(b.date ?? ""));
  // Locked pages that don't match a draft page (added by hand) stay too.
  for (const l of locked) if (!pages.includes(l)) pages.push(l);
  pages.push(keep.find((p) => p.type === "end" && p.locked) ?? { id: pid(), type: "end", title: "See you next year!", titleAr: "إلى اللقاء في العام القادم!", layout: "single", photos: [] });
  return pages.filter((p, i, a) => a.indexOf(p) === i);
}

// ---------- Checks: fair balance, everyone in, ready, print quality ----------
export function bookChecks(db: Db, spec: BookSpec, pages: Page[]) {
  const classes = classesOf(db, spec);
  const inBook = new Map<string, number>();
  const photoIds = [...new Set(pages.filter((p) => p.type !== "cover").flatMap((p) => p.photos))];
  const q = db.prepare("select student_id from faces where photo_id = ? and status in ('confirmed', 'manual') and student_id is not null");
  for (const id of photoIds) for (const r of q.all(id) as { student_id: string }[]) inBook.set(r.student_id, (inBook.get(r.student_id) ?? 0) + 1);
  const students = classes.flatMap((c) => studentsIn(db, spec, c));
  const counted = students.filter((s) => s.can_post || spec.cantAppear === "blur");
  const avg = counted.length ? counted.reduce((a, s) => a + (inBook.get(s.id) ?? 0), 0) / counted.length : 0;
  const nm = (s: Student) => s.name_en ?? s.name_ar ?? s.id;
  const over = counted.filter((s) => (inBook.get(s.id) ?? 0) >= Math.max(4, avg * 2.5)).map((s) => ({ id: s.id, name: nm(s), n: inBook.get(s.id) ?? 0 }));
  const missing = counted.filter((s) => !inBook.get(s.id)).map((s) => ({ id: s.id, name: nm(s), className: s.class_name }));
  // Ready: 3 good photos in the year and one where they're the focus.
  const ready = db.prepare(
    `select count(distinct p.id) n, sum(case when f.w >= 0.12 or p.face_count <= 3 then 1 else 0 end) focus from faces f join photos p on p.id = f.photo_id
     where f.student_id = ? and f.status in ('confirmed', 'manual') and ${USABLE} and p.year = ?`,
  );
  const notReady = counted
    .map((s) => ({ s, r: ready.get(s.id, spec.year) as { n: number; focus: number | null } }))
    .filter(({ r }) => r.n < 3 || !r.focus)
    .map(({ s, r }) => ({ id: s.id, name: nm(s), className: s.class_name, photos: r.n }));
  const noFace = students.filter((s) => !s.face && !s.portrait).map((s) => ({ id: s.id, name: nm(s), className: s.class_name }));
  // 300 dpi: a photo filling a page needs about 2400 pixels on its long side.
  const size = db.prepare("select width, height from photos where id = ?");
  const lowRes = photoIds.filter((id) => {
    const r = size.get(id) as { width: number | null; height: number | null } | undefined;
    return r?.width && r.height && Math.max(r.width, r.height) < 1600;
  });
  const cantAppear = students.filter((s) => !s.can_post).map((s) => ({ id: s.id, name: nm(s) }));
  return { average: +avg.toFixed(1), over, missing, notReady, noFace, lowRes, cantAppear, students: students.length };
}

// Photos to swap into a page: the rest of the same event (or the year), best first.
export function pageCandidates(db: Db, spec: BookSpec, page: Page, limit = 120) {
  const classes = classesOf(db, spec);
  if (page.type === "year" && spec.studentId)
    return (db.prepare(`select distinct p.id from faces f join photos p on p.id = f.photo_id where f.student_id = ? and f.status in ('confirmed', 'manual') and ${USABLE} and p.year = ? order by ${PICKED} desc, p.flag desc, p.rating desc limit ?`).all(spec.studentId, page.year ?? "", limit) as { id: number }[]).map((r) => r.id);
  const list = page.event ? candidates(db, spec, [], "and p.event_key = ?", [page.event]) : candidates(db, spec, classes);
  return list.map((p) => p.id).filter((id) => !page.photos.includes(id)).slice(0, limit);
}

// ---------- Drawing the pages ----------
const SIZES = { A4: [210, 297], A5: [148, 210], square: [210, 210] } as const;
const THEMES = {
  classic: { bg: "#ffffff", ink: "#1b1d22", sub: "#6b7180", band: "transparent", coverBg: "linear-gradient(160deg, var(--soft), #fff 60%)", coverInk: "#1b1d22" },
  bold: { bg: "#ffffff", ink: "#15171c", sub: "#5d6370", band: "var(--accent)", coverBg: "var(--accent)", coverInk: "#ffffff" },
  soft: { bg: "#fbf8f4", ink: "#2b2a28", sub: "#857e74", band: "var(--soft)", coverBg: "linear-gradient(180deg, var(--soft), #fbf8f4)", coverInk: "#2b2a28" },
  night: { bg: "#ffffff", ink: "#1b1d22", sub: "#6b7180", band: "#16181d", coverBg: "#16181d", coverInk: "#ffffff" },
};

export type Resolver = { photo: (id: number) => string; face: (s: { id: string; face: number | null; portrait: string | null }) => string | null; logo: string | null };

export function bookHtml(db: Db, spec: BookSpec, pages: Page[], r: Resolver, opts: { only?: string; screen?: boolean } = {}) {
  const lang = spec.language;
  const both = lang === "both";
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const [w, h] = SIZES[spec.size ?? "A4"];
  const bleed = spec.bleed ? 3 : 0;
  const slug = spec.cropMarks ? 8 : 0;
  const pw = w + 2 * (bleed + slug), ph = h + 2 * (bleed + slug);
  const theme = THEMES[spec.theme ?? "classic"];
  const accent = /^#[0-9a-f]{6}$/i.test(spec.accent ?? "") ? spec.accent! : "#2f6fdf";
  const scale = w / 210;
  const titleOf = (p: Page) => (both ? `${esc(p.titleAr || p.title)}<span class="en">${esc(p.title)}</span>` : esc(ar ? p.titleAr || p.title : p.title || p.titleAr));
  const textOf = (p: Page) => {
    const a = p.textAr ?? "", e = p.text ?? "";
    if (both) return [a && `<p class="txt" dir="rtl">${esc(a)}</p>`, e && `<p class="txt" dir="ltr">${esc(e)}</p>`].filter(Boolean).join("");
    const t = ar ? a || e : e || a;
    return t ? `<p class="txt">${esc(t)}</p>` : "";
  };
  const person = db.prepare(`select s.id, s.name_en, s.name_ar, s.class_name, s.portrait, s.can_post, s.left_on, s.kind, coalesce(s.joined, (select min(h.year) from school_history h where h.student_id = s.id)) since, ${MAIN_FACE} face from students s where s.id = ?`);
  const nameOf = (s: Student) => (ar || both ? s.name_ar || s.name_en : s.name_en || s.name_ar) ?? s.id;
  const otherOf = (s: Student) => (ar || both ? s.name_en : s.name_ar) ?? "";
  const faceHtml = (s: Student) => {
    const blurred = !s.can_post && spec.cantAppear !== "blur";
    const src = blurred ? null : r.face(s);
    return src ? `<img src="${src}" />` : `<span>${esc(nameOf(s).slice(0, 1))}</span>`;
  };
  const img = (id: number) => `<img src="${r.photo(id)}" />`;
  const sinceLabel = (s: Student) => (s.since ? (ar ? `معنا منذ ${String(s.since).slice(0, 4)}` : `With us since ${String(s.since).slice(0, 4)}`) : "");

  const body = (p: Page) => {
    if (p.type === "cover") {
      const st = p.students?.[0] ? (person.get(p.students[0]) as Student | undefined) : undefined;
      const style = spec.cover?.style ?? (st ? "plain" : "photo");
      const bg = style === "photo" && p.photos[0] ? `<div class="coverimg">${img(p.photos[0])}</div>` : "";
      const faces = style === "faces" ? `<div class="coverfaces">${classesOf(db, spec).flatMap((c) => studentsIn(db, spec, c)).filter((s) => s.can_post).slice(0, 48).map((s) => `<i>${faceHtml(s)}</i>`).join("")}</div>` : "";
      return `<div class="cover ${style}">${bg}${faces}<div class="covertext">${r.logo ? `<img class="logo" src="${r.logo}" />` : ""}<p class="sub">${esc(spec.school)}</p>
        ${st ? `<div class="hero">${faceHtml(st)}</div><h1>${esc(nameOf(st))}</h1><h2>${esc(otherOf(st))}</h2>` : `<h1>${titleOf(p)}</h1>`}
        <p class="sub">${esc([spec.cover?.subtitle, spec.grade, spec.className, spec.year].filter(Boolean).join(" · "))}</p></div></div>`;
    }
    if (p.type === "class" || p.type === "teachers" || p.type === "staff") {
      const list = (p.students ?? []).map((id) => person.get(id) as Student | undefined).filter(Boolean) as Student[];
      const cols = list.length > 30 ? 6 : 5;
      const teacher = p.type === "class" && p.className ? (db.prepare("select t.id, t.name_en, t.name_ar, t.portrait, t.can_post, t.kind, null since, null left_on, null class_name, (select f.id from faces f where f.student_id = t.id and f.status in ('confirmed', 'manual', 'portrait') order by f.w desc limit 1) face from class_teachers ct join students t on t.id = ct.teacher_id where ct.class_name = ?").get(p.className) as Student | undefined) : undefined;
      const grad = spec.kind === "graduation" || /12|KG2/i.test(spec.grade ?? p.className ?? "");
      return `<header><h1>${titleOf(p)}</h1>${teacher ? `<p class="sub">${ar ? "معلم الفصل" : "Class teacher"}: ${esc(nameOf(teacher))}</p>` : ""}</header>${textOf(p)}
        <div class="faces c${cols}">${list.map((s) => `<figure class="${s.left_on ? "left" : ""}">${faceHtml(s)}<figcaption><b>${esc(nameOf(s))}</b>${both || otherOf(s) ? `<small>${esc(otherOf(s))}</small>` : ""}${grad && s.since ? `<small class="since">${esc(sinceLabel(s))}</small>` : ""}</figcaption></figure>`).join("")}</div>`;
    }
    const n = Math.min(p.photos.length, 9);
    const layout = p.layout === "auto" ? (n <= 1 ? "single" : n <= 4 ? "hero" : "grid") : p.layout;
    return `<header><h2>${titleOf(p)}</h2>${p.date ? `<p class="sub">${esc(p.date)}</p>` : ""}</header>${textOf(p)}${n ? `<div class="ph ${layout} n${n}">${p.photos.slice(0, 9).map(img).join("")}</div>` : ""}`;
  };
  const marks = slug
    ? `<i class="cm" style="left:${slug + bleed}mm;top:0;height:${slug - 1}mm"></i><i class="cm" style="left:${pw - slug - bleed}mm;top:0;height:${slug - 1}mm"></i><i class="cm" style="left:${slug + bleed}mm;bottom:0;height:${slug - 1}mm"></i><i class="cm" style="left:${pw - slug - bleed}mm;bottom:0;height:${slug - 1}mm"></i>
       <i class="cm h" style="top:${slug + bleed}mm;left:0;width:${slug - 1}mm"></i><i class="cm h" style="top:${ph - slug - bleed}mm;left:0;width:${slug - 1}mm"></i><i class="cm h" style="top:${slug + bleed}mm;right:0;width:${slug - 1}mm"></i><i class="cm h" style="top:${ph - slug - bleed}mm;right:0;width:${slug - 1}mm"></i>`
    : "";
  const list = opts.only ? pages.filter((p) => p.id === opts.only) : pages;
  const html = list.map((p, i) => `<section class="sheet" data-page="${esc(p.id)}">${marks}<div class="bleed"><div class="page t-${p.type}">${body(p)}${p.type !== "cover" ? `<footer>${pages.indexOf(p) + 1}</footer>` : ""}</div></div></section>`).join("");
  return `<!doctype html><html lang="${ar || both ? "ar" : "en"}" dir="${dir}"><head><meta charset="utf-8" /><style>
  @page { size: ${pw}mm ${ph}mm; margin: 0; }
  :root { --accent: ${accent}; --soft: color-mix(in srgb, ${accent} 14%, #fff); --ink: ${theme.ink}; --sub: ${theme.sub}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "IBM Plex Sans Arabic", "Inter", -apple-system, "Geeza Pro", "Segoe UI", sans-serif; color: var(--ink); font-size: ${10 * scale}pt; }
  .sheet { width: ${pw}mm; height: ${ph}mm; position: relative; page-break-after: always; overflow: hidden; background: #fff; }
  .bleed { position: absolute; inset: ${slug}mm; background: ${theme.bg}; overflow: hidden; }
  .page { position: absolute; inset: ${bleed}mm; padding: ${14 * scale}mm ${12 * scale}mm ${16 * scale}mm; display: flex; flex-direction: column; gap: ${5 * scale}mm; }
  .cm { position: absolute; width: 0; border-left: .25pt solid #000; } .cm.h { height: 0; width: auto; border-left: 0; border-top: .25pt solid #000; }
  header { border-inline-start: ${1.6 * scale}mm solid var(--accent); padding-inline-start: ${3 * scale}mm; }
  ${theme.band !== "transparent" ? `.page:not(.t-cover)::before { content: ""; position: absolute; inset-inline: -${bleed}mm; top: -${bleed}mm; height: ${(6 + bleed) * scale}mm; background: ${theme.band}; }` : ""}
  h1 { font-size: ${26 * scale}pt; margin: 0; line-height: 1.15; } h2 { font-size: ${18 * scale}pt; margin: 0; line-height: 1.2; } .sub { color: var(--sub); margin: 1mm 0 0; font-size: ${10 * scale}pt; }
  .en { display: block; font-size: .6em; color: var(--sub); font-weight: 500; direction: ltr; }
  .txt { margin: 0; font-size: ${10.5 * scale}pt; line-height: 1.55; color: var(--ink); }
  footer { position: absolute; bottom: ${7 * scale}mm; inset-inline-end: ${12 * scale}mm; font-size: ${8 * scale}pt; color: var(--sub); }
  .t-cover { padding: 0; }
  .cover { position: absolute; inset: -${bleed}mm; display: flex; align-items: center; justify-content: center; text-align: center; background: ${theme.coverBg}; color: ${theme.coverInk}; }
  .cover .sub { color: inherit; opacity: .8; }
  .cover.photo .covertext { position: absolute; inset-inline: 0; bottom: 0; padding: ${18 * scale}mm ${14 * scale}mm; background: linear-gradient(transparent, rgba(0,0,0,.6)); color: #fff; }
  .coverimg { position: absolute; inset: 0; } .coverimg img { width: 100%; height: 100%; object-fit: cover; }
  .coverfaces { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(8, 1fr); gap: 1.5mm; padding: 4mm; opacity: .35; } .coverfaces img, .coverfaces span { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 50%; display: block; background: #ddd; }
  .cover.faces .covertext { position: relative; background: ${theme.coverBg}; padding: ${10 * scale}mm; border-radius: 6mm; }
  .logo { height: ${16 * scale}mm; margin-bottom: 4mm; }
  .hero img, .hero span { width: ${70 * scale}mm; height: ${70 * scale}mm; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: #eef0f3; font-size: 40pt; margin: 6mm auto; }
  .faces { display: grid; gap: ${4 * scale}mm ${3 * scale}mm; } .faces.c5 { grid-template-columns: repeat(5, 1fr); } .faces.c6 { grid-template-columns: repeat(6, 1fr); }
  .faces figure { margin: 0; text-align: center; } .faces figure.left { opacity: .85; }
  .faces img, .faces span { width: ${27 * scale}mm; height: ${27 * scale}mm; border-radius: 50%; object-fit: cover; display: grid; place-items: center; margin: 0 auto; background: #eef0f3; font-size: 16pt; color: var(--sub); border: ${0.8 * scale}mm solid var(--soft); }
  .faces.c6 img, .faces.c6 span { width: ${23 * scale}mm; height: ${23 * scale}mm; }
  .faces figcaption { font-size: ${8 * scale}pt; margin-top: 1.2mm; line-height: 1.25; } .faces small { display: block; color: var(--sub); } .faces .since { color: var(--accent); }
  .ph { flex: 1; display: grid; gap: ${3 * scale}mm; min-height: 0; }
  .ph img { width: 100%; height: 100%; object-fit: cover; border-radius: ${1.5 * scale}mm; min-height: 0; display: block; }
  .ph.single { grid-template: 1fr / 1fr; }
  .ph.hero.n2 { grid-template: 1fr 1fr / 1fr; } .ph.hero.n3 { grid-template: 2fr 1fr / 1fr 1fr; } .ph.hero.n3 img:first-child { grid-column: span 2; } .ph.hero.n4 { grid-template: 2fr 1fr / 1fr 1fr 1fr; } .ph.hero.n4 img:first-child { grid-column: span 3; }
  .ph.grid { grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; } .ph.grid.n5 img:first-child, .ph.grid.n7 img:first-child, .ph.grid.n9 img:first-child { grid-column: span 2; } .ph.grid.n7, .ph.grid.n8, .ph.grid.n9 { grid-template-columns: 1fr 1fr 1fr; } .ph.grid.n7 img:first-child { grid-column: span 3; }
  .ph.collage { grid-template-columns: repeat(6, 1fr); grid-auto-rows: 1fr; } .ph.collage img:nth-child(3n+1) { grid-column: span 4; } .ph.collage img:nth-child(3n+2) { grid-column: span 2; } .ph.collage img:nth-child(3n) { grid-column: span 6; }
  .t-welcome .txt, .t-end .txt { font-size: ${13 * scale}pt; }
  .t-end { justify-content: center; text-align: center; } .t-end header { border: 0; }
  ${opts.screen ? `body { background: transparent; } .sheet { margin: 0 auto; box-shadow: 0 4px 18px rgba(0,0,0,.25); }` : ""}
  </style></head><body>${html}</body></html>`;
}

export const pageSize = (spec: BookSpec) => {
  const [w, h] = SIZES[spec.size ?? "A4"];
  const extra = 2 * ((spec.bleed ? 3 : 0) + (spec.cropMarks ? 8 : 0));
  return { width: (w + extra) / 25.4, height: (h + extra) / 25.4, mmW: w + extra, mmH: h + extra };
};
