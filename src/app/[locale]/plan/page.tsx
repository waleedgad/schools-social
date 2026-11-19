import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Card, Chip, Notice } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { getPlanStatus, seesPlan } from "@/lib/plan";
import { requireMembership } from "@/lib/session";

// Settings > Plan: what the school's plan allows and what it uses, and how
// to renew. No prices inside the app. Admin and Comms lead only.
export default async function PlanPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!seesPlan(membership.role)) redirect({ href: "/today", locale });
  const t = await getTranslations();
  const format = await getFormatter();
  const plan = await getPlanStatus(membership.school.id);
  const name = plan ? (locale === "ar" ? plan.plan.name_ar : plan.plan.name_en) : "";
  const tone = plan?.state === "active" ? "good" : plan?.state === "read_only" ? "warn" : "danger";
  const date = (d: string) => format.dateTime(new Date(`${d}T12:00:00`), { dateStyle: "long" });
  const meter = (used: number, limit: number) => (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-grey-bg">
      <div className={`h-full rounded-full ${used >= limit ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, Math.round((used / Math.max(limit, 1)) * 100))}%` }} />
    </div>
  );

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="plan" title={t("plan.page.title")} subtitle={t("plan.page.subtitle")}>
      {!plan ? (
        <Notice>{t("plan.page.unknown")}</Notice>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <Card title={t("plan.page.yourPlan")} action={<Chip tone={tone}>{t(`plan.states.${plan.state}`)}</Chip>}>
            <p className="text-2xl font-bold" data-testid="plan-name">
              {name}
              {plan.trial && <span className="ms-2 align-middle text-sm font-semibold text-muted">{t("plan.page.trial")}</span>}
            </p>
            <p className="mt-1 text-sm text-muted">
              {plan.state === "active"
                ? t("plan.page.paidUntil", { date: date(plan.paid_until) })
                : plan.state === "read_only" && !plan.forced
                  ? t("plan.bar.readOnly", { days: plan.read_only_left })
                  : t(`plan.states.${plan.state}`)}
            </p>
          </Card>
          <Card title={t("plan.page.renew")}>
            <p className="text-sm text-muted">{t("plan.page.renewHint")}</p>
            {plan.contact && (
              <p className="mt-2 whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold" dir="auto">
                {plan.contact}
              </p>
            )}
          </Card>
          <Card title={t("plan.page.managers")}>
            <p className="text-sm">
              <b className="text-lg">{t("plan.page.used", { used: plan.managers, limit: plan.manager_limit })}</b>
            </p>
            {meter(plan.managers, plan.manager_limit)}
            <p className="mt-2 text-xs text-muted">{t("plan.page.managersHint")}</p>
          </Card>
          <Card title={t("plan.page.computers")}>
            <p className="text-sm">
              <b className="text-lg">{t("plan.page.used", { used: plan.computers, limit: plan.computer_limit })}</b>
            </p>
            {meter(plan.computers, plan.computer_limit)}
            <p className="mt-2 text-xs text-muted">{t("plan.page.computersHint")}</p>
          </Card>
          <Card title={t("plan.page.statesTitle")} className="md:col-span-2">
            <ul className="space-y-1.5 text-sm text-muted">
              <li>
                <b className="text-foreground">{t("plan.states.active")}:</b> {t("plan.page.stateActive")}
              </li>
              <li>
                <b className="text-foreground">{t("plan.states.read_only")}:</b> {t("plan.page.stateReadOnly")}
              </li>
              <li>
                <b className="text-foreground">{t("plan.states.blocked")}:</b> {t("plan.page.stateBlocked")}
              </li>
            </ul>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
