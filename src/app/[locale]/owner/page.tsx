import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { OwnerShell } from "@/components/owner-shell";
import { Chip, Empty, Pills, Stat } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { requireOwner, type OwnerSchool } from "@/lib/owner";

const FILTERS = ["all", "ending", "read_only", "blocked", "trial"] as const;
type Filter = (typeof FILTERS)[number];

// Schools: one row per school with its plan, state, "paid until" and what
// it uses. Totals at the top.
export default async function OwnerSchoolsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ f?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { supabase } = await requireOwner(locale);
  const t = await getTranslations();
  const format = await getFormatter();
  const sp = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as Filter) : "all";

  const [{ data }, { data: settings }] = await Promise.all([supabase.rpc("owner_schools"), supabase.from("owner_settings").select("currency").maybeSingle()]);
  const schools = (data ?? []) as OwnerSchool[];
  const currency = (settings?.currency as string | undefined) ?? "EGP";
  const ending = (s: OwnerSchool) => s.state === "active" && s.days_left >= 0 && s.days_left <= 14;
  const shown = schools.filter((s) =>
    filter === "all" ? true : filter === "ending" ? ending(s) : filter === "trial" ? s.trial : s.state === filter,
  );

  // Money due this month: schools whose "paid until" falls before the end of
  // this month and are not blocked, at their plan's yearly price.
  const now = new Date();
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const due = schools.filter((s) => s.state !== "blocked" && !s.trial && s.paid_until <= monthEnd).reduce((sum, s) => sum + Number(s.price_year ?? 0), 0);
  const tone = { active: "good", read_only: "warn", blocked: "danger" } as const;
  const date = (d: string) => format.dateTime(new Date(`${d}T12:00:00`), { dateStyle: "medium" });

  return (
    <OwnerShell locale={locale} active="schools" title={t("owner.schools.title")}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("owner.schools.active")} value={schools.filter((s) => s.state === "active").length} />
        <Stat label={t("owner.schools.endingSoon")} value={schools.filter(ending).length} />
        <Stat label={t("owner.schools.notActive")} value={schools.filter((s) => s.state !== "active").length} />
        <Stat label={t("owner.schools.dueThisMonth")} value={format.number(due, { style: "currency", currency, maximumFractionDigits: 0 })} />
      </div>
      <Pills items={FILTERS.map((f) => ({ label: t(`owner.schools.filters.${f}`), href: { pathname: "/owner", query: f === "all" ? {} : { f } }, on: filter === f }))} />
      {!shown.length ? (
        <Empty icon="people" title={t("owner.schools.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[760px] text-sm" data-testid="owner-schools">
            <thead className="text-start text-xs text-muted">
              <tr className="border-b border-border">
                {["name", "plan", "state", "paidUntil", "managers", "computers", "lastActivity"].map((c) => (
                  <th key={c} className="px-3 py-2 text-start font-semibold">
                    {t(`owner.schools.cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-background">
                  <td className="px-3 py-2">
                    <Link href={`/owner/schools/${s.id}`} className="font-semibold text-accent-ink hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {locale === "ar" ? s.plan_ar : s.plan_en}
                    {s.trial && <span className="ms-1 text-xs text-muted">({t("owner.trial")})</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={tone[s.state]}>{t(`plan.states.${s.state}`)}</Chip>
                  </td>
                  <td className="px-3 py-2">
                    {date(s.paid_until)}
                    <span className={`block text-xs ${s.days_left < 0 ? "text-danger" : s.days_left <= 14 ? "text-warn" : "text-muted"}`}>
                      {s.days_left < 0 ? t("owner.daysAgo", { days: -s.days_left }) : t("owner.daysLeft", { days: s.days_left })}
                    </span>
                  </td>
                  <td className={`px-3 py-2 ${s.managers >= s.manager_limit ? "font-semibold text-warn" : ""}`}>
                    {s.managers} / {s.manager_limit}
                  </td>
                  <td className={`px-3 py-2 ${s.computers >= s.computer_limit ? "font-semibold text-warn" : ""}`}>
                    {s.computers} / {s.computer_limit}
                  </td>
                  <td className="px-3 py-2 text-muted">{s.last_activity ? format.relativeTime(new Date(s.last_activity)) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OwnerShell>
  );
}
