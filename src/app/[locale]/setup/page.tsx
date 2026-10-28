import { getTranslations, setRequestLocale } from "next-intl/server";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/shell";
import { Card } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { SETUP_LINKS, SETUP_STEPS, setupState } from "@/lib/setup";
import { createClient } from "@/lib/supabase/server";

// The set-up checklist: each step ticks itself when it's done.
export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "manageCategories", membership.school.permissions)) redirect({ href: "/today", locale });
  const t = await getTranslations();
  const { done, count } = await setupState(await createClient(), membership.school.id);
  const next = SETUP_STEPS.find((s) => !done[s]);

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="today" title={t("setup.title")} subtitle={t("setup.progress", { done: count, total: SETUP_STEPS.length })}>
      <div className="h-2 overflow-hidden rounded-full bg-grey-bg">
        <div className="h-full rounded-full bg-good transition-all" style={{ width: `${(count / SETUP_STEPS.length) * 100}%` }} />
      </div>
      <ol className="space-y-2">
        {SETUP_STEPS.map((s, i) => (
          <li key={s}>
            <Link href={SETUP_LINKS[s]}>
              <Card className={`flex items-center gap-4 !p-4 transition hover:border-accent ${s === next ? "border-accent" : ""}`}>
                <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${done[s] ? "bg-good text-white" : "bg-grey-bg"}`}>{done[s] ? <Icon name="check" /> : i + 1}</span>
                <div className="min-w-0 grow">
                  <b className={done[s] ? "text-muted line-through" : ""}>{t(`setup.steps.${s}.title`)}</b>
                  <p className="text-sm text-muted">{t(`setup.steps.${s}.body`)}</p>
                </div>
                <Icon name="chevron" className="text-faint rtl:rotate-180" />
              </Card>
            </Link>
          </li>
        ))}
      </ol>
    </AppShell>
  );
}
