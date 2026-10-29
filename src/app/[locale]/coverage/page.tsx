import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Button, Card, Chip, Empty, Notice, Pills, Stat } from "@/components/ui";
import { makeShotList } from "@/lib/actions/team";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { classScope, classStudents, nameKey } from "@/lib/team";

type Cov = { student_code: string; class_name: string | null; photos: number; posts: number; good: number; focus: number; ready: boolean; too_often: boolean; last_photo: string | null; updated_at: string };

// Coverage worked out on the Mac (counts only), so the class teacher sees
// on the phone who is missing from photos and posts.
export default async function CoveragePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ class?: string; show?: string; q?: string; made?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { class: pick, show = "missing", q = "", made } = await searchParams;
  const { user, membership, workspaces } = await requireMembership(locale);
  const t = await getTranslations("more");
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const scope = await classScope(supabase, schoolId, user.id, membership.role);
  const students = await classStudents(supabase, schoolId, scope, locale);
  const classes = [...new Set(students.map((s) => s.className).filter(Boolean))] as string[];
  const cls = pick && classes.includes(pick) ? pick : scope.all ? undefined : classes[0];

  let cq = supabase.from("student_coverage").select("student_code, class_name, photos, posts, good, focus, ready, too_often, last_photo, updated_at").eq("school_id", schoolId);
  if (cls) cq = cq.eq("class_name", cls);
  else if (!scope.all) cq = cq.in("class_name", classes.length ? classes : ["-"]);
  const { data } = await cq.limit(5000).returns<Cov[]>();
  const cov = new Map((data ?? []).map((c) => [c.student_code, c]));
  const inClass = students.filter((s) => !cls || s.className === cls);
  const key = nameKey(q);
  const rows = inClass
    .map((s) => ({ ...s, c: cov.get(s.code) }))
    .filter((r) => (!key || nameKey(`${r.nameEn} ${r.nameAr ?? ""}`).includes(key)))
    .filter((r) => (show === "missing" ? !r.c?.good : show === "few" ? (r.c?.good ?? 0) > 0 && (r.c?.good ?? 0) < 3 : show === "often" ? r.c?.too_often : true))
    .sort((a, b) => (a.c?.good ?? 0) - (b.c?.good ?? 0));
  const withGood = inClass.filter((s) => (cov.get(s.code)?.good ?? 0) > 0).length;
  const inPosts = inClass.filter((s) => (cov.get(s.code)?.posts ?? 0) > 0).length;
  const ready = inClass.filter((s) => cov.get(s.code)?.ready).length;
  const updated = (data ?? []).reduce((m, c) => (c.updated_at > m ? c.updated_at : m), "");
  const pct = (n: number) => (inClass.length ? `${Math.round((n / inClass.length) * 100)}%` : "–");
  const query = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries({ class: cls, show, q: q || undefined, ...o }).filter(([, v]) => v)) as Record<string, string>;

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="coverage" title={t("coverage.title")} subtitle={updated ? t("coverage.updated", { when: new Date(updated).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: membership.school.timezone }) }) : t("coverage.subtitle")}>
      {made && <Notice tone="good">{t("coverage.made", { count: Number(made) })}</Notice>}
      {!scope.all && !classes.length ? (
        <Empty icon="students" title={t("coverage.noClasses")} body={t("coverage.noClassesHint")} />
      ) : !data?.length ? (
        <Empty icon="chart" title={t("coverage.none")} body={t("coverage.noneHint")} />
      ) : (
        <>
          {classes.length > 1 && <Pills items={[...(scope.all ? [{ label: t("coverage.allClasses"), href: { pathname: "/coverage", query: query({ class: undefined }) }, on: !cls }] : []), ...classes.map((c) => ({ label: c, href: { pathname: "/coverage", query: query({ class: c }) }, on: cls === c }))]} />}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("coverage.students")} value={inClass.length} />
            <Stat label={t("coverage.withGood")} value={pct(withGood)} />
            <Stat label={t("coverage.inPosts")} value={pct(inPosts)} />
            <Stat label={t("coverage.ready")} value={pct(ready)} />
          </div>
          <Card
            title={t("coverage.list")}
            action={
              cls && (
                <form action={makeShotList}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="class" value={cls} />
                  <Button variant="quiet" icon="camera" className="!py-1.5 text-xs">{t("coverage.fill")}</Button>
                </form>
              )
            }
          >
            <form className="mb-3 flex flex-wrap items-center gap-2">
              {cls && <input type="hidden" name="class" value={cls} />}
              <input type="hidden" name="show" value={show} />
              <input name="q" defaultValue={q} placeholder={t("coverage.search")} className="min-w-40 grow rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm" />
            </form>
            <Pills items={[["missing", t("coverage.missing")], ["few", t("coverage.few")], ["often", t("coverage.often")], ["all", t("coverage.everyone")]].map(([k, l]) => ({ label: l, href: { pathname: "/coverage", query: query({ show: k }) }, on: show === k }))} />
            {!rows.length ? (
              <p className="py-6 text-center text-sm text-muted">{t("coverage.nobody")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {rows.map((r) => (
                  <li key={r.code} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 grow">
                      <b className="block truncate text-sm">{r.name}</b>
                      <span className="text-xs text-muted">
                        {r.className ?? ""}
                        {r.c?.last_photo ? ` · ${t("coverage.last", { date: r.c.last_photo })}` : ""}
                      </span>
                    </div>
                    <Chip tone={!r.c?.good ? "danger" : r.c.good < 3 ? "warn" : "good"}>{t("coverage.good", { count: r.c?.good ?? 0 })}</Chip>
                    <Chip tone={r.c?.posts ? "info" : "grey"}>{t("coverage.posts", { count: r.c?.posts ?? 0 })}</Chip>
                    {r.c?.too_often && <Chip tone="violet">{t("coverage.tooOften")}</Chip>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="text-center text-xs text-muted">{t("coverage.privacy")}</p>
        </>
      )}
    </AppShell>
  );
}
