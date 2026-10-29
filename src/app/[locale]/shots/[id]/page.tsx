import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { ButtonLink, Card, Chip, Notice, Pills } from "@/components/ui";
import { tickShot } from "@/lib/actions/team";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Shot = { code: string; name_en: string | null; name_ar: string | null; class_name: string | null; good: number; focus: number; done?: boolean };

// The shot list while taking photos: who still needs a good photo, fewest
// first. Tick a student off once you have them.
export default async function ShotListPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ show?: string; class?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { show = "todo", class: cls } = await searchParams;
  const { membership, workspaces } = await requireMembership(locale);
  const t = await getTranslations("more");
  const supabase = await createClient();
  const { data: ev } = await supabase.from("events").select("id, title, event_date, class_name, shot_list").eq("id", id).eq("school_id", membership.school.id).maybeSingle();
  const all = ((ev?.shot_list as Shot[] | undefined) ?? []).slice().sort((a, b) => a.good - b.good);
  const classes = [...new Set(all.map((s) => s.class_name).filter(Boolean))] as string[];
  const list = all.filter((s) => (show === "todo" ? !s.done : show === "done" ? s.done : true) && (!cls || s.class_name === cls));
  const done = all.filter((s) => s.done).length;
  const name = (s: Shot) => (locale === "ar" ? s.name_ar || s.name_en : s.name_en || s.name_ar) || s.code;
  const q = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries({ show, class: cls, ...o }).filter(([, v]) => v)) as Record<string, string>;

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="shots" title={(ev?.title as string) ?? t("shots.title")} subtitle={ev ? t("shots.progress", { done, total: all.length }) : undefined} actions={<ButtonLink href="/upload" icon="upload" variant="quiet">{t("shots.upload")}</ButtonLink>}>
      {!ev ? (
        <Notice>{t("shots.missing")}</Notice>
      ) : (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-grey-bg"><div className="h-full bg-good transition-all" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} /></div>
          <div className="flex flex-wrap gap-3">
            <Pills items={[["todo", t("shots.todo")], ["done", t("shots.done")], ["all", t("shots.all")]].map(([k, l]) => ({ label: l, href: { pathname: `/shots/${id}`, query: q({ show: k }) }, on: show === k }))} />
            {classes.length > 1 && <Pills items={[{ label: t("shots.allClasses"), href: { pathname: `/shots/${id}`, query: q({ class: undefined }) }, on: !cls }, ...classes.map((c) => ({ label: c, href: { pathname: `/shots/${id}`, query: q({ class: c }) }, on: cls === c }))]} />}
          </div>
          <Card className="!p-2">
            {!list.length ? (
              <p className="p-4 text-center text-sm text-muted">{show === "todo" ? t("shots.allDone") : t("shots.nobody")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {list.map((s) => (
                  <li key={s.code}>
                    <form action={tickShot} className="flex items-center gap-3 p-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="event" value={id} />
                      <input type="hidden" name="code" value={s.code} />
                      <input type="hidden" name="done" value={s.done ? "0" : "1"} />
                      <button className={`grid size-9 shrink-0 place-items-center rounded-full border-2 text-lg ${s.done ? "border-good bg-good text-white" : "border-border"}`} aria-label={s.done ? t("shots.untick") : t("shots.tick")}>
                        {s.done ? "✓" : ""}
                      </button>
                      <div className="min-w-0 grow">
                        <b className={`block truncate ${s.done ? "text-muted line-through" : ""}`}>{name(s)}</b>
                        <span className="text-xs text-muted">{s.class_name ?? ""}</span>
                      </div>
                      <Chip tone={s.good === 0 ? "danger" : s.good < 3 ? "warn" : "good"}>{t("shots.good", { count: s.good })}</Chip>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="text-center text-xs text-muted">{t("shots.hint")}</p>
        </>
      )}
    </AppShell>
  );
}
