import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { LocalTime } from "@/components/local-datetime";
import { Card } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = { id: number; user_id: string | null; action: string; target: string | null; created_at: string };

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership } = await requireMembership(locale);
  if (!can(membership.role, "signOffSensitive")) redirect({ href: "/dashboard", locale });

  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  const size = 100;
  const t = await getTranslations();
  const supabase = await createClient();
  const [{ data: rows }, { data: members }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, user_id, action, target, created_at")
      .eq("school_id", membership.school.id)
      .order("created_at", { ascending: false })
      .range(page * size, page * size + size - 1)
      .returns<Row[]>(),
    supabase.from("memberships").select("user_id, full_name").eq("school_id", membership.school.id),
  ]);
  const names = new Map((members ?? []).map((m) => [m.user_id as string, m.full_name as string]));

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("activity.title")}</h1>
          <Link href="/dashboard" className="text-sm text-accent hover:underline">
            {t("staff.back")}
          </Link>
        </div>
        <p className="text-sm text-muted">{t("activity.hint")}</p>
        <Card className="p-0">
          <ul className="divide-y divide-border text-sm">
            {(rows ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-semibold">{r.user_id ? (names.get(r.user_id) ?? t("activity.former")) : t("activity.system")}</span>{" "}
                  {t.has(`activity.actions.${r.action}`) ? t(`activity.actions.${r.action}`) : r.action}
                </span>
                <span className="text-xs text-muted">
                  <LocalTime iso={r.created_at} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex justify-between text-sm">
          {page > 0 ? (
            <Link href={{ pathname: "/activity", query: { page: String(page - 1) } }} className="text-accent">
              {t("calendar.previous")}
            </Link>
          ) : (
            <span />
          )}
          {(rows ?? []).length === size && (
            <Link href={{ pathname: "/activity", query: { page: String(page + 1) } }} className="text-accent">
              {t("calendar.next")}
            </Link>
          )}
        </div>
      </PageBody>
    </>
  );
}
