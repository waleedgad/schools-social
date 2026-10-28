import type { Db } from "./db";

// Yearbooks and graduation books, laid out on this Mac and saved as A4 PDFs.
// A yearbook covers one grade for one school year: a class page per class
// (every student's face and name) and pages for the year's events. A book
// for one student adds their own photos; a graduation book (KG2, Grade 12)
// adds a page for every year they were at the school.

export type BookSpec = {
  kind: "yearbook" | "student" | "graduation";
  year: string;
  grade?: string | null;
  className?: string | null;
  studentId?: string | null;
  school: string;
  language: "ar" | "en";
};

type Student = { id: string; name_en: string | null; name_ar: string | null; class_name: string | null; grade: string | null; face: number | null; portrait: string | null };
type Photo = { id: number; event_title: string | null; event_date: string | null; quality: number | null };

const MAIN_FACE = `coalesce(s.main_face, (select f.id from faces f join photos p on p.id = f.photo_id where f.student_id = s.id and f.status in ('confirmed', 'manual', 'portrait') and p.missing = 0 order by f.auto, f.status = 'portrait' desc, f.w * f.score desc limit 1))`;
const USABLE = "p.missing = 0 and p.pair_of is null and p.dup_of is null and p.flag >= 0";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function studentsOf(db: Db, where: string, ...args: string[]) {
  return db.prepare(`select s.id, s.name_en, s.name_ar, s.class_name, s.grade, s.portrait, ${MAIN_FACE} as face from students s where ${where} order by coalesce(s.name_en, s.name_ar)`).all(...args) as Student[];
}

// The best photos of each event, spread so one event can't fill the book.
function eventPhotos(db: Db, year: string, filter: string, args: string[], perEvent: number) {
  const rows = db
    .prepare(`select p.id, p.event_key, p.event_title, p.event_date, p.quality from photos p where ${USABLE} and p.year = ? and p.event_key is not null ${filter} order by p.event_date, p.flag desc, p.rating desc, p.quality desc`)
    .all(year, ...args) as (Photo & { event_key: string })[];
  const byEvent = new Map<string, Photo[]>();
  for (const r of rows) {
    const list = byEvent.get(r.event_key) ?? [];
    if (list.length < perEvent) list.push(r);
    byEvent.set(r.event_key, list);
  }
  return [...byEvent.values()];
}

function photosOfStudent(db: Db, studentId: string, year: string | null, limit: number) {
  return db
    .prepare(
      `select distinct p.id, p.event_title, p.event_date, p.quality, p.year from faces f join photos p on p.id = f.photo_id
       where f.student_id = ? and f.status in ('confirmed', 'manual') and ${USABLE} ${year ? "and p.year = ?" : ""}
       order by p.flag desc, p.rating desc, p.quality desc limit ?`,
    )
    .all(studentId, ...(year ? [year] : []), limit) as (Photo & { year: string })[];
}

export function bookPages(db: Db, spec: BookSpec) {
  const ar = spec.language === "ar";
  const T = (en: string, a: string) => (ar ? a : en);
  const nm = (s: Student) => (ar ? s.name_ar || s.name_en : s.name_en || s.name_ar) ?? s.id;
  const other = (s: Student) => (ar ? s.name_en : s.name_ar) ?? "";
  const face = (s: Student) => (s.face ? `<img src="hub://face/${s.face}" />` : s.portrait ? `<img src="hub://portrait/${encodeURIComponent(s.id)}" />` : `<span>${esc(nm(s).slice(0, 1))}</span>`);
  const img = (p: Photo) => `<img src="hub://preview/${p.id}" />`;
  const pages: string[] = [];

  const classPage = (className: string) => {
    const list = studentsOf(db, "s.class_name = ?", className);
    pages.push(`<section class="page"><h1>${T("Class", "فصل")} ${esc(className)}</h1><p class="sub">${esc(spec.year)}</p>
      <div class="class">${list.map((s) => `<figure>${face(s)}<figcaption><b>${esc(nm(s))}</b><small>${esc(other(s))}</small></figcaption></figure>`).join("")}</div></section>`);
  };
  const eventPages = (groups: Photo[][]) => {
    for (const g of groups) {
      if (!g.length) continue;
      pages.push(`<section class="page"><h2>${esc(g[0].event_title)}</h2><p class="sub">${esc(g[0].event_date ?? "")}</p><div class="grid n${Math.min(g.length, 6)}">${g.map(img).join("")}</div></section>`);
    }
  };

  if (spec.kind === "yearbook") {
    const classes = (db.prepare("select distinct class_name from students where grade = ? and class_name is not null order by class_name").all(spec.grade ?? "") as { class_name: string }[]).map((c) => c.class_name);
    pages.push(`<section class="page cover"><p class="sub">${esc(spec.school)}</p><h1>${T("Yearbook", "الكتاب السنوي")}</h1><h2>${esc(spec.grade ?? "")}</h2><p class="sub">${esc(spec.year)}</p></section>`);
    for (const c of classes) classPage(c);
    const args = classes.length ? classes : ["-"];
    eventPages(eventPhotos(db, spec.year, `and (p.class_name in (${args.map(() => "?").join(",")}) or p.class_name is null)`, args, 6));
    return pages;
  }

  const s = studentsOf(db, "s.id = ?", spec.studentId ?? "")[0];
  if (!s) return pages;
  pages.push(`<section class="page cover"><p class="sub">${esc(spec.school)}</p><div class="hero">${face(s)}</div><h1>${esc(nm(s))}</h1><h2>${esc(other(s))}</h2>
    <p class="sub">${spec.kind === "graduation" ? T("Graduation", "التخرج") : T("Yearbook", "الكتاب السنوي")} · ${esc(s.class_name ?? "")} · ${esc(spec.year)}</p></section>`);

  if (spec.kind === "graduation") {
    // Only the years they were here: no empty pages before they joined.
    const years = (db.prepare(
      `select distinct p.year from faces f join photos p on p.id = f.photo_id where f.student_id = ? and f.status in ('confirmed', 'manual') and ${USABLE} and p.year is not null order by p.year`,
    ).all(s.id) as { year: string }[]).map((y) => y.year);
    for (const y of years) {
      const list = photosOfStudent(db, s.id, y, 6);
      if (list.length) pages.push(`<section class="page"><h2>${esc(y)}</h2><div class="grid n${Math.min(list.length, 6)}">${list.map(img).join("")}</div></section>`);
    }
  } else {
    const mine = photosOfStudent(db, s.id, spec.year, 12);
    for (let i = 0; i < mine.length; i += 6) {
      const chunk = mine.slice(i, i + 6);
      pages.push(`<section class="page"><h2>${T("My year", "عامي")}</h2><div class="grid n${chunk.length}">${chunk.map(img).join("")}</div></section>`);
    }
  }
  if (s.class_name) classPage(s.class_name);
  if (spec.kind === "student") eventPages(eventPhotos(db, spec.year, "and (p.class_name = ? or p.class_name is null)", [s.class_name ?? "-"], 4));
  return pages;
}

export function bookHtml(spec: BookSpec, pages: string[]) {
  const dir = spec.language === "ar" ? "rtl" : "ltr";
  return `<!doctype html><html lang="${spec.language}" dir="${dir}"><head><meta charset="utf-8" /><style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Plex Arabic", "Inter", -apple-system, "Geeza Pro", sans-serif; color: #1b1d22; }
  .page { width: 210mm; height: 297mm; padding: 16mm 14mm; page-break-after: always; display: flex; flex-direction: column; gap: 6mm; overflow: hidden; }
  h1 { font-size: 30pt; margin: 0; } h2 { font-size: 20pt; margin: 0; } .sub { color: #6b7180; margin: 0; font-size: 11pt; }
  .cover { justify-content: center; align-items: center; text-align: center; background: linear-gradient(160deg, #eaf1fe, #fff 60%); }
  .hero img, .hero span { width: 70mm; height: 70mm; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: #eef0f3; font-size: 40pt; }
  .class { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5mm 4mm; }
  .class figure { margin: 0; text-align: center; }
  .class img, .class span { width: 30mm; height: 30mm; border-radius: 50%; object-fit: cover; display: grid; place-items: center; margin: 0 auto; background: #eef0f3; font-size: 16pt; color: #6b7180; }
  .class figcaption { font-size: 8.5pt; margin-top: 1.5mm; line-height: 1.25; } .class small { display: block; color: #6b7180; }
  .grid { flex: 1; display: grid; gap: 4mm; min-height: 0; }
  .grid img { width: 100%; height: 100%; object-fit: cover; border-radius: 2mm; min-height: 0; }
  .n1 { grid-template: 1fr / 1fr; } .n2 { grid-template: 1fr 1fr / 1fr; } .n3 { grid-template: 1fr 1fr / 1fr 1fr; } .n3 img:first-child { grid-column: span 2; }
  .n4 { grid-template: 1fr 1fr / 1fr 1fr; } .n5 { grid-template: 1fr 1fr 1fr / 1fr 1fr; } .n5 img:first-child { grid-column: span 2; } .n6 { grid-template: 1fr 1fr 1fr / 1fr 1fr; }
  </style></head><body>${pages.join("")}</body></html>`;
}
