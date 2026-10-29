import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Button, Card, Chip, Empty, Notice, Pills, TextArea } from "@/components/ui";
import { sendReport, setReportStatus } from "@/lib/actions/team";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Problems reported from the Mac app or the website. Everyone sees their
// own; the school admin sees all of them and marks them seen or fixed.
export default async function ReportsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ show?: string; sent?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { show = "open", sent } = await searchParams;
  const { membership, workspaces } = await requireMembership(locale);
  const t = await getTranslations("more");
  const supabase = await createClient();
  const admin = membership.role === "admin";
  let q = supabase.from("problem_reports").select("id, user_id, body, info, status, created_at, log, screenshot").eq("school_id", membership.school.id).order("created_at", { ascending: false }).limit(60);
  if (show !== "all") q = q.neq("status", "fixed");
  const { data } = await q;
  const users = [...new Set((data ?? []).map((r) => r.user_id as string).filter(Boolean))];
  const { data: people } = users.length ? await supabase.from("memberships").select("user_id, full_name").eq("school_id", membership.school.id).in("user_id", users) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.user_id as string, p.full_name as string]));
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: membership.school.timezone });

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="reports" title={t("reports.title")} subtitle={admin ? t("reports.subtitleAdmin") : t("reports.subtitle")}>
      {sent && <Notice tone="good">{t("reports.sent")}</Notice>}
      <Card title={t("reports.new")}>
        <form action={sendReport} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="page" value="reports" />
          <TextArea label={t("reports.what")} name="body" rows={3} maxLength={4000} required />
          <Button icon="warning">{t("reports.send")}</Button>
        </form>
      </Card>
      <Pills items={[["open", t("reports.open")], ["all", t("reports.all")]].map(([k, l]) => ({ label: l, href: { pathname: "/reports", query: { show: k } }, on: show === k }))} />
      {!data?.length ? (
        <Empty icon="check" title={t("reports.none")} />
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id as string}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Chip tone={r.status === "fixed" ? "good" : r.status === "seen" ? "info" : "warn"}>{t(`reports.status.${r.status}`)}</Chip>
                  <span>{fmt(r.created_at as string)}</span>
                  <span>· {name.get(r.user_id as string) ?? ""}</span>
                  {r.info && <span className="ltr">· {r.info as string}</span>}
                </div>
                <p className="whitespace-pre-wrap text-sm">{r.body as string}</p>
                {r.screenshot && (
                  // eslint-disable-next-line @next/next/no-img-element -- a data URL sent with the report
                  <img src={r.screenshot as string} alt={t("reports.screenshot")} className="max-h-72 rounded-lg border border-border" />
                )}
                {admin && r.log && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted">{t("reports.log")}</summary>
                    <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-background p-2 ltr">{r.log as string}</pre>
                  </details>
                )}
                {admin && (
                  <form action={setReportStatus} className="flex gap-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={r.id as string} />
                    {r.status !== "seen" && <Button name="status" value="seen" variant="quiet" className="!py-1 text-xs">{t("reports.markSeen")}</Button>}
                    {r.status !== "fixed" && <Button name="status" value="fixed" variant="good" className="!py-1 text-xs">{t("reports.markFixed")}</Button>}
                  </form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
