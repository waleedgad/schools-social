import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { StudentImport } from "@/components/student-import";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { addStudent, removeStudent, setConsent } from "@/lib/actions/students";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { nameKey } from "@/lib/team";

type Student = {
  id: string;
  full_name: string;
  class_name: string | null;
  parent_phone: string | null;
  consent_social: "yes" | "no" | "unknown";
  name_ar: string | null;
  kind: string;
  stage: string | null;
  grade: string | null;
  birthday: string | null;
  clubs: string[];
  achievements: { title?: string; date?: string }[];
  class_teacher: string | null;
  active: boolean;
  left_on: string | null;
};
const KINDS = ["student", "teacher", "staff", "parent", "visitor"] as const;

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
  searchParams: Promise<{ class?: string; error?: string; imported?: string; kind?: string; stage?: string; grade?: string; q?: string; left?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "manageConsent")) redirect({ href: "/today", locale });

  const { class: classFilter, error, imported, kind = "student", stage, grade, q = "", left } = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();

  const { data: all } = await supabase
    .from("students")
    .select("id, full_name, class_name, parent_phone, consent_social, name_ar, kind, stage, grade, birthday, clubs, achievements, class_teacher, active, left_on")
    .eq("school_id", membership.school.id)
    .order("class_name")
    .order("full_name")
    .returns<Student[]>();

  const everyone = all ?? [];
  const students = everyone.filter((s) => (s.kind ?? "student") === kind && (left ? !s.active : s.active !== false));
  // Stage > Grade > Class, from the class lists the Mac sends.
  const stages = [...new Set(students.map((s) => s.stage).filter(Boolean))] as string[];
  const inStage = stage ? students.filter((s) => s.stage === stage) : students;
  const grades = [...new Set(inStage.map((s) => s.grade).filter(Boolean))] as string[];
  const inGrade = grade ? inStage.filter((s) => s.grade === grade) : inStage;
  const classes = [...new Set(inGrade.map((s) => s.class_name).filter(Boolean))] as string[];
  const key = nameKey(q);
  const shown = (classFilter ? inGrade.filter((s) => s.class_name === classFilter) : inGrade).filter((s) => !key || nameKey(`${s.full_name} ${s.name_ar ?? ""}`).includes(key));
  const query = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries({ kind, stage, grade, class: classFilter, q: q || undefined, left, ...o }).filter(([, v]) => v)) as Record<string, string>;
  // Birthdays in the next 7 days (month and day only).
  const md = (d: Date) => d.toISOString().slice(5, 10);
  const soon = new Set(Array.from({ length: 7 }, (_, i) => md(new Date(Date.now() + i * 86400_000))));
  const birthdays = everyone.filter((s) => s.active !== false && s.birthday && soon.has(s.birthday.slice(5, 10))).slice(0, 12);
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
        {birthdays.length > 0 && (
          <Notice tone="info">
            🎂 {t("more.students.birthdays")}: {birthdays.map((s) => `${locale === "ar" && s.name_ar ? s.name_ar : s.full_name} (${s.birthday!.slice(5)})`).join("، ")}
          </Notice>
        )}

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
          <div className="flex flex-wrap gap-1.5 text-xs">
            {KINDS.filter((k) => k === "student" || everyone.some((s) => s.kind === k)).map((k) => (
              <Link key={k} href={{ pathname: "/students", query: { kind: k } }} className={`rounded-full border px-3 py-1 font-semibold ${kind === k ? "border-accent bg-accent-bg text-accent-ink" : "border-border"}`}>
                {t(`more.students.kinds.${k}`)} <span className="text-muted">{everyone.filter((s) => (s.kind ?? "student") === k && s.active !== false).length}</span>
              </Link>
            ))}
            <Link href={{ pathname: "/students", query: query({ left: left ? undefined : "1", stage: undefined, grade: undefined, class: undefined }) }} className={`rounded-full border px-3 py-1 font-semibold ${left ? "border-accent bg-accent-bg text-accent-ink" : "border-border"}`}>
              {t("more.students.left")}
            </Link>
          </div>
          <form className="flex gap-2">
            {Object.entries(query({ q: undefined })).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={q} placeholder={t("more.students.search")} className="grow rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm" />
          </form>
          {[
            { list: stages, on: stage, param: "stage", reset: { grade: undefined, class: undefined } },
            { list: grades, on: grade, param: "grade", reset: { class: undefined } },
            { list: classes, on: classFilter, param: "class", reset: {} },
          ].map((row) =>
            row.list.length > 1 || (row.param === "class" && row.list.length) ? (
              <div key={row.param} className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="w-14 text-xs text-muted">{t(`more.students.${row.param}`)}</span>
                <Link href={{ pathname: "/students", query: query({ [row.param]: undefined, ...row.reset }) }} className={`rounded-full border border-border px-3 py-1 ${!row.on ? "bg-background font-semibold" : ""}`}>
                  {t("students.allClasses")}
                </Link>
                {row.list.map((c) => (
                  <Link key={c} href={{ pathname: "/students", query: query({ [row.param]: c, ...row.reset }) }} className={`rounded-full border border-border px-3 py-1 ${row.on === c ? "bg-background font-semibold" : ""}`}>
                    {c}
                  </Link>
                ))}
              </div>
            ) : null,
          )}
          {!shown.length && <p className="text-sm text-muted">{t("students.empty")}</p>}
          <ul className="divide-y divide-border">
            {shown.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">
                    {locale === "ar" && s.name_ar ? s.name_ar : s.full_name}
                    {s.name_ar && <span className="ms-2 text-sm font-normal text-muted">{locale === "ar" ? s.full_name : s.name_ar}</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {[s.stage, s.grade, s.class_name].filter(Boolean).join(" › ") || "—"}
                    {s.class_teacher && <span> · {t("more.students.classTeacher", { name: s.class_teacher })}</span>}
                    {s.parent_phone && <span dir="ltr"> · {s.parent_phone}</span>}
                    {s.left_on && <span> · {t("more.students.leftOn", { date: s.left_on })}</span>}
                  </p>
                  {(s.clubs?.length > 0 || s.achievements?.length > 0 || s.birthday) && (
                    <p className="mt-1 flex flex-wrap gap-1 text-xs">
                      {s.birthday && <span className="rounded-full bg-violet-bg px-2 py-0.5 text-violet">🎂 {s.birthday.slice(5)}</span>}
                      {(s.clubs ?? []).map((c) => <span key={c} className="rounded-full bg-info-bg px-2 py-0.5 text-info">{c}</span>)}
                      {(s.achievements ?? []).slice(0, 3).map((a, i) => <span key={i} className="rounded-full bg-good-bg px-2 py-0.5 text-good">🏆 {a.title ?? ""}</span>)}
                    </p>
                  )}
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
