import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { OwnerShell } from "@/components/owner-shell";
import { Empty } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { requireOwner } from "@/lib/owner";

type Row = { id: number; school_id: string | null; action: string; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: string; school: { name: string } | null };

// Every owner action with its time and reason, so a mistaken block can be
// traced and undone.
export default async function OwnerLogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { supabase } = await requireOwner(locale);
  const t = await getTranslations();
  const format = await getFormatter();
  const { data } = await supabase.from("owner_log").select("id, school_id, action, reason, before, after, at, school:schools(name)").order("at", { ascending: false }).limit(300).returns<Row[]>();
  const rows = data ?? [];
  const change = (r: Row) => {
    const keys = ["state", "plan_id", "paid_until", "extra_managers", "extra_computers", "amount"];
    return keys
      .filter((k) => r.after && k in r.after && JSON.stringify(r.before?.[k]) !== JSON.stringify(r.after[k]))
      .map((k) => `${t.has(`owner.log.fields.${k}`) ? t(`owner.log.fields.${k}`) : k}: ${r.before?.[k] ?? "–"} → ${r.after?.[k]}`)
      .join(" · ");
  };

  return (
    <OwnerShell locale={locale} active="log" title={t("owner.log.title")}>
      {!rows.length ? (
        <Empty icon="activity" title={t("owner.log.empty")} />
      ) : (
        <ul className="divide-y divide-border card text-sm" data-testid="owner-log">
          {rows.map((r) => (
            <li key={r.id} className="space-y-0.5 px-4 py-2.5">
              <div className="flex flex-wrap gap-x-2">
                <span className="text-muted">{format.dateTime(new Date(r.at), { dateStyle: "medium", timeStyle: "short" })}</span>
                <b>{t.has(`owner.log.actions.${r.action.replace(/\./g, "_")}`) ? t(`owner.log.actions.${r.action.replace(/\./g, "_")}`) : r.action}</b>
                {r.school_id && r.school && (
                  <Link href={`/owner/schools/${r.school_id}`} className="text-accent-ink hover:underline">
                    {r.school.name}
                  </Link>
                )}
              </div>
              {(r.reason || change(r)) && (
                <p className="text-xs text-muted" dir="auto">
                  {[r.reason && `“${r.reason}”`, change(r)].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </OwnerShell>
  );
}
