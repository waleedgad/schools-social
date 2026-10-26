"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { importStudents } from "@/lib/actions/students";
import { parseCsv, rowsToStudents, type StudentInput } from "@/lib/student-import";

export function StudentImport({ locale }: { locale: string }) {
  const t = useTranslations("students");
  const [students, setStudents] = useState<StudentInput[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  async function read(file: File) {
    setError(false);
    try {
      const rows = file.name.toLowerCase().endsWith(".csv")
        ? parseCsv(await file.text())
        : ((await (await import("read-excel-file")).default(file)) as unknown[][]);
      const parsed = rowsToStudents(rows);
      setStudents(parsed);
      if (!parsed.length) setError(true);
    } catch {
      setStudents(null);
      setError(true);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("importHint")}</p>
      <input
        type="file"
        accept=".xlsx,.csv"
        onChange={(e) => e.target.files?.[0] && read(e.target.files[0])}
        className="block w-full text-sm"
      />
      {error && <p className="text-sm text-danger">{t("importError")}</p>}
      {students && students.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">{t("importReady", { count: students.length })}</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => importStudents(locale, students))}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
          >
            {t("importButton")}
          </button>
        </div>
      )}
    </div>
  );
}
