"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { inviteMany, type StaffRow } from "@/lib/actions/staff";
import { parseCsv } from "@/lib/student-import";
import { Button } from "./ui";

const COLS: Record<keyof StaffRow, string[]> = {
  name: ["name", "full name", "staff name", "الاسم", "اسم الموظف", "الاسم الكامل"],
  email: ["email", "e-mail", "mail", "البريد", "البريد الإلكتروني", "الإيميل"],
  phone: ["phone", "mobile", "whatsapp", "الهاتف", "الموبايل", "واتساب", "رقم الهاتف"],
  role: ["role", "job", "position", "الدور", "الوظيفة"],
  classes: ["classes", "class", "classes taught", "الفصول", "الفصل"],
};

// The staff list from Excel or CSV: name, email or phone, role, classes.
export function StaffImport({ locale }: { locale: string }) {
  const t = useTranslations("more.staffImport");
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  async function read(file: File) {
    setError(false);
    setDone(null);
    try {
      const table = file.name.toLowerCase().endsWith(".csv") ? parseCsv(await file.text()) : ((await (await import("read-excel-file")).default(file)) as unknown[][]);
      const head = (table[0] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
      const at = (k: keyof StaffRow) => head.findIndex((h) => COLS[k].includes(h));
      const idx = { name: at("name"), email: at("email"), phone: at("phone"), role: at("role"), classes: at("classes") };
      const cell = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      const out = table
        .slice(1)
        .map((r) => ({ name: cell(r, idx.name), email: cell(r, idx.email), phone: cell(r, idx.phone), role: cell(r, idx.role), classes: cell(r, idx.classes) }))
        .filter((r) => r.email || r.phone);
      setRows(out);
      if (!out.length) setError(true);
    } catch {
      setRows(null);
      setError(true);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("hint")}</p>
      <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} className="block w-full text-sm" />
      {error && <p className="text-sm text-danger">{t("error")}</p>}
      {done !== null && <p className="text-sm text-good">{t("done", { count: done })}</p>}
      {rows && rows.length > 0 && done === null && (
        <div className="space-y-2">
          <ul className="max-h-48 divide-y divide-border overflow-auto rounded-lg border border-border text-sm">
            {rows.slice(0, 50).map((r, i) => (
              <li key={i} className="flex justify-between gap-2 px-2 py-1">
                <span className="truncate">{r.name || "—"}</span>
                <span className="truncate text-muted" dir="ltr">{r.email || r.phone}</span>
                <span className="shrink-0 text-xs text-muted">{r.role || t("teacher")}</span>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await inviteMany(locale, rows);
                if (r.ok) setDone(r.count);
                else setError(true);
              })
            }
          >
            {t("invite", { count: rows.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
