import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { StudentImport } from "@/components/student-import";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { addStudent, removeStudent, setConsent } from "@/lib/actions/students";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Student = {
  id: string;
  full_name: string;
  class_name: string | null;
  parent_phone: string | null;
  consent_social: "yes" | "no" | "unknown";
};

const CONSENT_STYLE = {
  yes: "text-[color:var(--accent)]",
  no: "text-danger",
  unknown: "text-muted",
};

export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ class?: string; error?: string; imported?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "manageConsent")) redirect({ href: "/today", locale });

  const { class: classFilter, error, imported } = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();

  const { data: all } = await supabase
    .from("students")
    .select("id, full_name, class_name, parent_phone, consent_social")
    .eq("school_id", membership.school.id)
    .order("class_name")
    .order("full_name")
    .returns<Student[]>();

  const students = all ?? [];
  const classes = [...new Set(students.map((s) => s.class_name).filter(Boolean))] as string[];
  const shown = classFilter ? students.filter((s) => s.class_name === classFilter) : students;
  const counts = {
    yes: students.filter((s) => s.consent_social === "yes").length,
    no: students.filter((s) => s.consent_social === "no").length,
    unknown: students.filter((s) => s.consent_social === "unknown").length,
  };

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="students" title={t("students.title")}>

        {imported && <Notice tone="info">{t("students.imported", { count: Number(imported) })}</Notice>}
        {error && <Notice>{t("students.error")}</Notice>}

        <div className="grid gap-4 sm:grid-cols-3">
          {(["yes", "no", "unknown"] as const).map((c) => (
            <Card key={c} className="p-4">
              <p className={`text-2xl font-bold ${CONSENT_STYLE[c]}`}>{counts[c]}</p>
              <p className="text-sm text-muted">{t(`students.consent.${c}`)}</p>
            </Card>
          ))}
        </div>
        <p className="text-sm text-muted">{t("students.unknownRule")}</p>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-3">
            <h2 className="font-semibold">{t("students.import")}</h2>
            <StudentImport locale={locale} />
          </Card>
          <Card>
            <form action={addStudent} className="space-y-3">
              <h2 className="font-semibold">{t("students.add")}</h2>
              <input type="hidden" name="locale" value={locale} />
              <Field label={t("students.name")} name="fullName" minLength={2} maxLength={120} required />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("library.className")} name="className" maxLength={60} />
                <Field label={t("students.phone")} name="parentPhone" type="tel" dir="ltr" maxLength={30} />
              </div>
              <Select label={t("students.consentLabel")} name="consent" defaultValue="unknown">
                <option value="unknown">{t("students.consent.unknown")}</option>
                <option value="yes">{t("students.consent.yes")}</option>
                <option value="no">{t("students.consent.no")}</option>
              </Select>
              <Button>{t("students.addButton")}</Button>
            </form>
          </Card>
        </div>

        <Card className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href="/students" className={`rounded-full border border-border px-3 py-1 ${!classFilter ? "bg-background font-semibold" : ""}`}>
              {t("students.allClasses")}
            </Link>
            {classes.map((c) => (
              <Link
                key={c}
                href={{ pathname: "/students", query: { class: c } }}
                className={`rounded-full border border-border px-3 py-1 ${classFilter === c ? "bg-background font-semibold" : ""}`}
              >
                {c}
              </Link>
            ))}
          </div>
          {!shown.length && <p className="text-sm text-muted">{t("students.empty")}</p>}
          <ul className="divide-y divide-border">
            {shown.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{s.full_name}</p>
                  <p className="text-sm text-muted">
                    {s.class_name ?? "—"}
                    {s.parent_phone && <span dir="ltr"> · {s.parent_phone}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <form action={setConsent} className="flex items-center gap-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={s.id} />
                    <select
                      name="consent"
                      defaultValue={s.consent_social}
                      aria-label={t("students.consentLabel")}
                      className={`rounded-lg border border-border bg-background px-2 py-1 text-sm ${CONSENT_STYLE[s.consent_social]}`}
                    >
                      <option value="unknown">{t("students.consent.unknown")}</option>
                      <option value="yes">{t("students.consent.yes")}</option>
                      <option value="no">{t("students.consent.no")}</option>
                    </select>
                    <Button variant="quiet" className="px-3 py-1">
                      {t("common.save")}
                    </Button>
                  </form>
                  <form action={removeStudent}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={s.id} />
                    <Button variant="danger" className="px-2 py-1">
                      {t("staff.remove")}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
    </AppShell>
  );
}
