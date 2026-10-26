// Reads a class list exported from Excel or Google Sheets. Column names can
// be Arabic or English; the order doesn't matter.

export type StudentInput = {
  full_name: string;
  class_name: string | null;
  parent_phone: string | null;
  consent_social: "yes" | "no" | "unknown";
};

const HEADERS: Record<keyof StudentInput, string[]> = {
  full_name: ["name", "student", "student name", "full name", "الاسم", "اسم الطالب", "الطالب"],
  class_name: ["class", "grade", "section", "الفصل", "الصف", "الفصل الدراسي"],
  parent_phone: ["phone", "parent phone", "mobile", "هاتف", "الهاتف", "هاتف ولي الأمر", "موبايل"],
  consent_social: ["consent", "photo consent", "social media", "الموافقة", "موافقة", "موافقة النشر"],
};

const YES = ["yes", "y", "true", "1", "نعم", "موافق", "موافقة"];
const NO = ["no", "n", "false", "0", "لا", "غير موافق", "رفض"];

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function parseConsent(value: unknown): StudentInput["consent_social"] {
  const v = normalize(value);
  if (YES.includes(v)) return "yes";
  if (NO.includes(v)) return "no";
  return "unknown";
}

export function rowsToStudents(rows: unknown[][]): StudentInput[] {
  if (rows.length < 2) return [];
  const header = rows[0].map(normalize);
  const column = (key: keyof StudentInput) => header.findIndex((h) => HEADERS[key].includes(h));
  const nameCol = column("full_name") >= 0 ? column("full_name") : 0;
  const classCol = column("class_name");
  const phoneCol = column("parent_phone");
  const consentCol = column("consent_social");

  return rows
    .slice(1)
    .map((row) => ({
      full_name: String(row[nameCol] ?? "").trim(),
      class_name: classCol >= 0 ? String(row[classCol] ?? "").trim() || null : null,
      parent_phone: phoneCol >= 0 ? String(row[phoneCol] ?? "").trim() || null : null,
      consent_social: consentCol >= 0 ? parseConsent(row[consentCol]) : ("unknown" as const),
    }))
    .filter((s) => s.full_name.length >= 2);
}

// Small CSV reader: handles quotes, commas or semicolons, and a BOM.
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const delimiter = (clean.split("\n")[0].match(/;/g)?.length ?? 0) > (clean.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
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
