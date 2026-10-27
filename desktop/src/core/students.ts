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

type Field = "id" | "en" | "ar" | "name" | "first" | "last" | "gender" | "stage" | "grade" | "section" | "class" | "portrait" | "post";

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
    });
  }
  return { format, students, skipped, columns };
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
