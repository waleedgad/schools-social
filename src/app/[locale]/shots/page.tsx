import { getTranslations, setRequestLocale } from "next-intl/server";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/shell";
import { Card, Chip, Empty } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Shot = { code: string; done?: boolean };

// Events with a shot list sent from the Mac's Coverage, for whoever is
// taking the photos.
export default async function ShotsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  const t = await getTranslations("more");
  const supabase = await createClient();
  const from = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const { data } = await supabase.from("events").select("id, title, event_date, class_name, shot_list").eq("school_id", membership.school.id).gte("event_date", from).neq("shot_list", "[]").order("event_date").limit(40);
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="shots" title={t("shots.title")} subtitle={t("shots.subtitle")}>
      {!data?.length ? (
        <Empty icon="camera" title={t("shots.none")} body={t("shots.noneHint")} />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {data.map((e) => {
              const list = (e.shot_list as Shot[]) ?? [];
              const done = list.filter((s) => s.done).length;
              return (
                <li key={e.id as string}>
                  <Link href={`/shots/${e.id}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                    <span className="grid size-10 place-items-center rounded-lg bg-accent-bg text-accent-ink"><Icon name="camera" /></span>
                    <div className="min-w-0 grow">
                      <b className="block truncate">{e.title as string}</b>
                      <span className="text-xs text-muted">{fmt(e.event_date as string)}{e.class_name ? ` · ${e.class_name}` : ""}</span>
                    </div>
                    <Chip tone={done === list.length ? "good" : "warn"}>{t("shots.progress", { done, total: list.length })}</Chip>
                    <Icon name="chevron" className="text-faint rtl:rotate-180" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}
