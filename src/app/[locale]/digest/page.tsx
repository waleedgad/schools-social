import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Card, Notice, Stat } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { weekDigest } from "@/lib/digest";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// The principal's weekly digest: what went out, what waits, and which
// students aren't in any photo yet. The Sunday email has the same numbers.
export default async function DigestPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "viewAnalytics", membership.school.permissions)) redirect({ href: "/today", locale });
  const t = await getTranslations("digest");
  // The numbers are the whole school's, whatever the reader may open, so
  // they match the email: read with the server key, for this school only.
  const db = isAdminConfigured ? createAdminClient() : await createClient();
  const d = await weekDigest(db, membership.school.id, membership.school.timezone || "Africa/Cairo");
  const nf = (n: number) => n.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB");
  const day = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="analytics" title={t("title")} subtitle={t("subtitle", { from: day(d.from), to: day(d.to) })}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-digest>
        <Stat label={t("posted")} value={<span data-n="posted">{nf(d.posted)}</span>} />
        <Stat label={t("failed")} value={<span data-n="failed">{nf(d.failed)}</span>} />
        <Stat label={t("scheduled")} value={<span data-n="scheduled">{nf(d.scheduled)}</span>} />
        <Stat label={t("waitingComms")} value={<span data-n="waitingComms">{nf(d.waitingComms)}</span>} />
        <Stat label={t("waitingExtra")} value={<span data-n="waitingExtra">{nf(d.waitingExtra)}</span>} />
        <Stat label={t("notSeen")} value={<><span data-n="notSeen">{nf(d.notSeen)}</span> <span className="text-sm font-normal text-muted">{t("ofStudents", { count: nf(d.students) })}</span></>} />
      </div>
      <Card title={t("byClass")}>
        {!d.students ? (
          <p className="text-sm text-muted">{t("noStudents")}</p>
        ) : !d.notSeen ? (
          <p className="text-sm text-muted">{t("allSeen")}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {d.notSeenByClass.map((c) => (
              <li key={c.className} className="flex justify-between py-1.5" data-class={c.className}>
                <span>{c.className || t("noClass")}</span>
                <b>{nf(c.count)}</b>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Notice tone="info">{t("email")}</Notice>
    </AppShell>
  );
}
