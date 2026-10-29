import { createHash } from "node:crypto";
import path from "node:path";

// Reads a class list. Works with our own template and recognises the
// student export files of PowerSchool, Classera and Edunation, so a school
// can use the file its system already gives them. Column order never matters.

export type StudentRow = {
  id: string;
  name_en: string | null;
  name_ar: string | null;
  gender: "M" | "F" | null;
  stage: string | null;
  grade: string | null;
  class_name: string | null;
  portrait: string | null;
  can_post: boolean;
  birthday?: string | null;
  joined?: string | null;
};

export type Format = "hub" | "powerschool" | "classera" | "edunation" | "other";
export type Parsed = { format: Format; students: StudentRow[]; skipped: number; columns: Record<string, string> };

const norm = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[()]/g, "")
    .trim();

type Field = "id" | "en" | "ar" | "name" | "first" | "last" | "gender" | "stage" | "grade" | "section" | "class" | "portrait" | "post" | "birthday" | "joined";

const SYNONYMS: Record<Field, string[]> = {
  id: ["student id", "student number", "student no", "admission no", "admission number", "id", "code", "student code", "رقم الطالب", "كود الطالب", "الرقم", "رقم القيد"],
  en: ["name english", "student name english", "english name", "name en", "اسم الطالب بالإنجليزية", "الاسم بالإنجليزية"],
  ar: ["name arabic", "student name arabic", "arabic name", "name ar", "اسم الطالب بالعربية", "الاسم بالعربية"],
  name: ["name", "student name", "full name", "student", "lastfirst", "اسم الطالب", "الاسم", "الطالب"],
  first: ["first name", "firstname"],
  last: ["last name", "lastname", "family name"],
  gender: ["gender", "sex", "الجنس", "النوع"],
  stage: ["stage", "division", "school level", "المرحلة", "المرحلة الدراسية"],
  grade: ["grade", "grade level", "level", "year group", "الصف", "الصف الدراسي", "المستوى"],
  section: ["section", "الشعبة", "الفصل الدراسي"],
  class: ["class", "home room", "homeroom", "class name", "الفصل"],
  portrait: ["portrait file", "portrait", "photo", "photo file", "picture", "الصورة", "صورة الطالب"],
  birthday: ["birthday", "date of birth", "birth date", "dob", "birthdate", "تاريخ الميلاد", "الميلاد"],
  joined: ["joined", "date joined", "enrollment date", "enrolment date", "entry date", "admission date", "enroll date", "تاريخ الالتحاق", "تاريخ القيد"],
  post: ["can appear in posts", "can post", "consent", "photo consent", "social media", "الموافقة", "موافقة النشر", "يظهر في المنشورات"],
};

const ARABIC = /[؀-ۿ]/;

const NO = ["no", "n", "false", "0", "لا", "غير موافق", "رفض"];

function detect(header: string[]): Format {
  const h = new Set(header);
  if (h.has("student number") && (h.has("lastfirst") || h.has("grade level"))) return "powerschool";
  if (h.has("رقم الطالب") && h.has("الشعبة")) return "classera";
  if (h.has("admission no") && h.has("section")) return "edunation";
  if (h.has("student id") && (h.has("name english") || h.has("name arabic"))) return "hub";
  return "other";
}

export function stageFor(grade: string | null) {
  if (!grade) return null;
  if (/^kg/i.test(grade)) return "KG";
  const n = Number(/\d+/.exec(grade)?.[0]);
  if (!n) return null;
  return n <= 6 ? "Primary" : n <= 9 ? "Prep" : "Secondary";
}

// "Grade 4", "4", "الصف 4", "-1" (PowerSchool KG1) and "KG 2" all become one label.
export function gradeLabel(value: unknown, format: Format = "other") {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^(kg|k|رياض|روضة)/i.test(v)) {
    const n = /\d/.exec(v)?.[0];
    return n ? `KG${n}` : "KG";
  }
  if (format === "powerschool" && /^-?\d+$/.test(v)) {
    const n = Number(v);
    if (n <= 0) return `KG${n + 2}`;
    return `Grade ${n}`;
  }
  const n = /\d+/.exec(v)?.[0];
  return n ? `Grade ${Number(n)}` : v.slice(0, 40);
}

export function classFrom(grade: string | null, section: string | null) {
  const sec = (section ?? "").trim();
  if (!grade) return sec || null;
  if (!sec) return grade;
  if (grade.startsWith("KG")) return `${grade}-${sec}`;
  const n = /\d+/.exec(grade)?.[0];
  return n ? `${n}${sec}` : `${grade} ${sec}`;
}

export function parseRows(rows: unknown[][]): Parsed {
  const start = rows.findIndex((r) => r.filter((c) => String(c ?? "").trim()).length >= 2);
  if (start < 0) return { format: "other", students: [], skipped: 0, columns: {} };
  const header = rows[start].map(norm);
  const format = detect(header);
  const col = {} as Record<Field, number>;
  const columns: Record<string, string> = {};
  for (const field of Object.keys(SYNONYMS) as Field[]) {
    col[field] = header.findIndex((h) => SYNONYMS[field].includes(h));
    if (col[field] >= 0) columns[field] = String(rows[start][col[field]]);
  }
  // Classera's "الفصل الدراسي" can mean the term; only treat it as a section when nothing better exists.
  const cell = (row: unknown[], field: Field) => (col[field] >= 0 ? String(row[col[field]] ?? "").trim() : "");

  const students: StudentRow[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const row of rows.slice(start + 1)) {
    let en = cell(row, "en");
    let ar = cell(row, "ar");
    let name = cell(row, "name");
    if (!name && (cell(row, "first") || cell(row, "last"))) name = `${cell(row, "first")} ${cell(row, "last")}`.trim();
    // PowerSchool's LastFirst is "Last, First".
    if (name.includes(",") && !ARABIC.test(name)) {
      const [last, first] = name.split(",").map((s) => s.trim());
      name = `${first} ${last}`.trim();
    }
    if (name) {
      if (ARABIC.test(name)) ar ||= name;
      else en ||= name;
    }
    if ((en || ar).length < 2) {
      if (row.some((c) => String(c ?? "").trim())) skipped++;
      continue;
    }
    const grade = gradeLabel(cell(row, "grade"), format);
    const klass = cell(row, "class") || classFrom(grade, cell(row, "section") || null);
    const g = norm(cell(row, "gender"));
    const gender = ["m", "male", "boy", "ذكر", "ولد"].includes(g) ? "M" : ["f", "female", "girl", "أنثى", "انثى", "بنت"].includes(g) ? "F" : null;
    const post = norm(cell(row, "post"));
    let id = cell(row, "id");
    if (!id) id = `X${createHash("sha1").update(`${en}|${ar}|${klass}`).digest("hex").slice(0, 8)}`;
    if (format === "powerschool" && /^\d+$/.test(id)) id = `S${id}`;
    if (seen.has(id)) {
      skipped++;
      continue;
    }
    seen.add(id);
    const stageCell = cell(row, "stage");
    students.push({
      id: id.slice(0, 40),
      name_en: en ? en.slice(0, 120) : null,
      name_ar: ar ? ar.slice(0, 120) : null,
      gender,
      stage: stageName(stageCell) ?? stageFor(grade),
      grade,
      class_name: klass ? klass.slice(0, 60) : null,
      portrait: cell(row, "portrait") ? path.basename(cell(row, "portrait")) : null,
      can_post: !NO.includes(post),
      birthday: isoDate(cell(row, "birthday")),
      joined: isoDate(cell(row, "joined")),
    });
  }
  return { format, students, skipped, columns };
}

// "2015-03-04", "4/3/2015" (day first, as schools here write it),
// "04-03-2015" and Excel's serial numbers all become 2015-03-04.
export function isoDate(v: string) {
  const t = v.trim();
  if (!t) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{5}(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400_000).toISOString().slice(0, 10);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---------- A new class list compared with the one on the Mac ----------

export type Known = { id: string; name_en: string | null; name_ar: string | null; class_name: string | null; kind: string | null; left_on: string | null };
export type ListChanges = {
  added: StudentRow[];
  moved: { id: string; name: string; from: string | null; to: string | null }[];
  renamed: { id: string; from: string; to: string }[];
  left: { id: string; name: string; class_name: string | null }[];
  back: { id: string; name: string }[];
};
const nm = (s: { name_en: string | null; name_ar: string | null }) => s.name_en ?? s.name_ar ?? "";

// Who is new, who moved class, whose name changed, who is no longer on the
// list (only students in the classes this file covers, so importing one
// class's file never marks the rest of the school as left) and who came back.
export function compareList(known: Known[], incoming: StudentRow[]): ListChanges {
  const byId = new Map(known.map((k) => [k.id, k]));
  const out: ListChanges = { added: [], moved: [], renamed: [], left: [], back: [] };
  for (const s of incoming) {
    const k = byId.get(s.id);
    if (!k) {
      out.added.push(s);
      continue;
    }
    if (k.left_on) out.back.push({ id: s.id, name: nm(s) });
    if ((k.class_name ?? null) !== (s.class_name ?? null)) out.moved.push({ id: s.id, name: nm(s), from: k.class_name, to: s.class_name });
    if ((s.name_en && k.name_en && s.name_en !== k.name_en) || (s.name_ar && k.name_ar && s.name_ar !== k.name_ar)) out.renamed.push({ id: s.id, from: nm(k), to: nm(s) });
  }
  const ids = new Set(incoming.map((s) => s.id));
  const covered = new Set(incoming.map((s) => s.class_name).filter(Boolean));
  for (const k of known)
    if ((k.kind ?? "student") === "student" && !k.left_on && !ids.has(k.id) && k.class_name && covered.has(k.class_name)) out.left.push({ id: k.id, name: nm(k), class_name: k.class_name });
  return out;
}

// ---------- New school year ----------

// The class each one moves up to: 4B → 5B, KG1-A → KG2-A, KG2-A → 1A,
// Grade 3 → Grade 4. Grade 12 (and KG2 for schools that end there) can
// graduate. The school can change any of these before it's applied.
export function nextClass(className: string | null, grade: string | null): { class_name: string | null; grade: string | null; graduates: boolean } {
  const g = grade ?? "";
  const kg = /^KG(\d)/i.exec(g) ?? /^KG(\d)/i.exec(className ?? "");
  if (kg) {
    const n = Number(kg[1]);
    const sec = (className ?? "").replace(/^KG\d[-\s]?/i, "");
    if (n >= 2) return { class_name: sec ? `1${sec}` : "Grade 1", grade: "Grade 1", graduates: false };
    return { class_name: sec ? `KG${n + 1}-${sec}` : `KG${n + 1}`, grade: `KG${n + 1}`, graduates: false };
  }
  const n = Number(/\d+/.exec(g)?.[0] ?? /^\d+/.exec(className ?? "")?.[0]);
  if (!n) return { class_name: className, grade, graduates: false };
  if (n >= 12) return { class_name: null, grade: null, graduates: true };
  const up = className ? className.replace(/\d+/, String(n + 1)) : null;
  return { class_name: up, grade: `Grade ${n + 1}`, graduates: false };
}

// The school year a date falls in: September to August ("2026-2027").
export function schoolYear(d = new Date()) {
  const y = d.getFullYear();
  return d.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// Students who are probably the same person entered twice: same name by
// spelling (Mohamed/Muhammad), different IDs.
export function likelyDuplicates(rows: { id: string; name_en: string | null; name_ar: string | null; class_name: string | null; kind: string | null }[], key: (s: string | null) => string) {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    for (const n of [r.name_en, r.name_ar]) {
      const k = key(n);
      if (k.length < 5 || k.split(" ").length < 2) continue;
      const g = groups.get(`${r.kind ?? "student"}|${k}`) ?? [];
      if (!g.includes(r)) g.push(r);
      groups.set(`${r.kind ?? "student"}|${k}`, g);
    }
  }
  const seen = new Set<string>();
  const pairs: [(typeof rows)[number], (typeof rows)[number]][] = [];
  for (const g of groups.values())
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const id = [g[i].id, g[j].id].sort().join("|");
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push([g[i], g[j]]);
      }
  return pairs;
}

function stageName(v: string) {
  if (!v) return null;
  const s = v.trim();
  if (/^(kg|رياض)/i.test(s)) return "KG";
  if (/^(primary|ابتدائي)/i.test(s)) return "Primary";
  if (/^(prep|preparatory|middle|إعدادي|اعدادي)/i.test(s)) return "Prep";
  if (/^(secondary|high|ثانوي)/i.test(s)) return "Secondary";
  return s.slice(0, 30);
}

// .xlsx through exceljs; .csv through a small reader.
export async function readSheet(file: string): Promise<unknown[][]> {
  if (/\.csv$/i.test(file)) {
    const { readFile } = await import("node:fs/promises");
    return parseCsv(await readFile(file, "utf8"));
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  // The first sheet that looks like a list.
  for (const ws of wb.worksheets) {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v && typeof v === "object") {
          const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
          if (o.richText) return o.richText.map((r) => r.text).join("");
          return o.text ?? o.result ?? "";
        }
        return v;
      });
      rows.push(values);
    });
    if (rows.length >= 2) return rows;
  }
  return [];
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split("\n")[0];
  const delimiter = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((c) => c.trim()));
}
