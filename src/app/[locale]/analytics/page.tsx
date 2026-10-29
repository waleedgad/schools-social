import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { PrintButton } from "@/components/print-button";
import { Icon } from "@/components/icons";
import { Card, Empty, Pills, Stat } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { thumbPath } from "@/lib/images";
import { categoryName } from "@/lib/posting";
import { signedThumbs } from "@/lib/posts";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string;
  caption_ar: string | null;
  caption_en: string | null;
  published_at: string;
  category_id: string | null;
  post_metrics: { platform: string; likes: number; comments: number; shares: number; reach: number; saves: number }[];
  post_photos: { position: number; photo: { storage_path: string; edited_path: string | null } | null }[];
};

const engagement = (p: Row) => p.post_metrics.reduce((a, m) => a + m.likes + m.comments * 2 + m.shares * 3 + m.saves * 2, 0);

// Results, the best posts, which categories and times work best, and the
// followers line. Numbers come from Facebook and Instagram every few hours.
export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ days?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "viewAnalytics", membership.school.permissions)) redirect({ href: "/today", locale });
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const since = new Date(Date.now() - days * 86400_000);
  const before = new Date(since.getTime() - days * 86400_000);

  const yearAgo = new Date(Date.now() - 365 * 86400_000);
  const [{ data: posts }, { data: earlier }, { data: cats }, { data: followers }, { data: history }] = await Promise.all([
    supabase
      .from("posts")
      .select("id, caption_ar, caption_en, published_at, category_id, post_metrics(platform, likes, comments, shares, reach, saves), post_photos(position, photo:photos(storage_path, edited_path))")
      .eq("school_id", schoolId)
      .eq("status", "published")
      .gte("published_at", since.toISOString())
      .returns<Row[]>(),
    supabase.from("posts").select("id, post_metrics(likes, comments, shares, reach)").eq("school_id", schoolId).eq("status", "published").gte("published_at", before.toISOString()).lt("published_at", since.toISOString()),
    supabase.from("categories").select("id, name_ar, name_en, color").eq("school_id", schoolId).order("position"),
    supabase.from("account_metrics").select("platform, day, followers").eq("school_id", schoolId).gte("day", since.toISOString().slice(0, 10)).order("day"),
    supabase.from("posts").select("published_at, post_metrics(likes, comments, shares, reach)").eq("school_id", schoolId).eq("status", "published").gte("published_at", yearAgo.toISOString()).limit(3000),
  ]);

  const list = posts ?? [];
  const total = (k: "likes" | "comments" | "shares" | "reach") => list.reduce((a, p) => a + p.post_metrics.reduce((b, m) => b + (m[k] ?? 0), 0), 0);
  const prevTotal = (k: "likes" | "comments" | "shares" | "reach") => (earlier ?? []).reduce((a, p) => a + ((p.post_metrics ?? []) as Record<string, number>[]).reduce((b, m) => b + (m[k] ?? 0), 0), 0);
  const change = (k: "likes" | "comments" | "shares" | "reach") => {
    const prev = prevTotal(k);
    return prev ? ((total(k) - prev) / prev) * 100 : null;
  };

  const best = [...list].sort((a, b) => engagement(b) - engagement(a)).slice(0, 6);
  const cover = (p: Row) => {
    const f = [...p.post_photos].sort((a, b) => a.position - b.position)[0]?.photo;
    return f ? thumbPath(f.edited_path ?? f.storage_path) : null;
  };
  const urls = await signedThumbs(supabase, best.map(cover).filter(Boolean) as string[]);

  // Average engagement per category and per posting hour.
  const byCat = (cats ?? []).map((c) => {
    const mine = list.filter((p) => p.category_id === c.id);
    return { c, count: mine.length, avg: mine.length ? mine.reduce((a, p) => a + engagement(p), 0) / mine.length : 0 };
  }).filter((x) => x.count);
  const maxCat = Math.max(1, ...byCat.map((x) => x.avg));
  const hours = Array.from({ length: 24 }, (_, h) => {
    const mine = list.filter((p) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: membership.school.timezone }).format(new Date(p.published_at))) % 24 === h);
    return { h, count: mine.length, avg: mine.length ? mine.reduce((a, p) => a + engagement(p), 0) / mine.length : 0 };
  });
  const maxHour = Math.max(1, ...hours.map((x) => x.avg));
  const bestHour = hours.filter((x) => x.count >= 2).sort((a, b) => b.avg - a.avg)[0];

  // The last twelve months, month by month.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 11 + i);
    return d.toISOString().slice(0, 7);
  }).map((m) => {
    const mine = (history ?? []).filter((p) => (p.published_at as string).startsWith(m));
    const sum = (k: string) => mine.reduce((a, p) => a + ((p.post_metrics ?? []) as Record<string, number>[]).reduce((b, x) => b + (x[k] ?? 0), 0), 0);
    return { m, posts: mine.length, reach: sum("reach"), likes: sum("likes"), comments: sum("comments") };
  });

  // Plain-language insights from the numbers above (no AI needed, so they
  // work on the free plan and never guess).
  const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;
  const insights: string[] = [];
  const sortedCats = [...byCat].filter((x) => x.count >= 2).sort((a, b) => b.avg - a.avg);
  if (sortedCats.length >= 2 && sortedCats[sortedCats.length - 1].avg > 0)
    insights.push(t("more.analytics.catInsight", { best: categoryName(sortedCats[0].c as { name_ar: string; name_en: string }, locale), worst: categoryName(sortedCats[sortedCats.length - 1].c as { name_ar: string; name_en: string }, locale), times: (sortedCats[0].avg / sortedCats[sortedCats.length - 1].avg).toFixed(1) }));
  if (bestHour) insights.push(t("more.analytics.hourInsight", { hour: `${bestHour.h}:00` }));
  const wd = Array.from({ length: 7 }, (_, w) => {
    const mine = list.filter((p) => new Date(p.published_at).getUTCDay() === w);
    return { w, count: mine.length, avg: mine.length ? mine.reduce((a, p) => a + engagement(p), 0) / mine.length : 0 };
  }).filter((x) => x.count >= 2).sort((a, b) => b.avg - a.avg)[0];
  if (wd) insights.push(t("more.analytics.dayInsight", { day: new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + wd.w))) }));
  const multi = list.filter((p) => p.post_photos.length > 1);
  const single = list.filter((p) => p.post_photos.length === 1);
  if (multi.length >= 2 && single.length >= 2) {
    const a = multi.reduce((x, p) => x + engagement(p), 0) / multi.length;
    const b = single.reduce((x, p) => x + engagement(p), 0) / single.length;
    if (b > 0) insights.push(t(a >= b ? "more.analytics.carouselBetter" : "more.analytics.singleBetter", { pct: fmtPct(Math.abs(a - b) / b * 100) }));
  }
  const prevCount = (earlier ?? []).length;
  if (prevCount) insights.push(t("more.analytics.countInsight", { now: list.length, before: prevCount }));
  const rc = change("reach");
  if (rc !== null) insights.push(t("more.analytics.reachInsight", { pct: fmtPct(rc) }));

  const fb = (followers ?? []).filter((f) => f.platform === "facebook");
  const ig = (followers ?? []).filter((f) => f.platform === "instagram");
  const growth = (rows: typeof fb) => (rows.length > 1 ? (rows[rows.length - 1].followers as number) - (rows[0].followers as number) : null);

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="analytics" title={t("analytics.title")} subtitle={t("analytics.subtitle")}>
      <div className="flex flex-wrap items-center gap-2">
        <Pills items={[7, 30, 90].map((d) => ({ label: t("analytics.lastDays", { count: d }), href: { pathname: "/analytics", query: { days: String(d) } }, on: d === days }))} />
        <span className="grow" />
        <a href={`/api/analytics?days=${days}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold hover:bg-background print:hidden">
          <Icon name="download" />
          {t("more.analytics.csv")}
        </a>
        <PrintButton label={t("more.analytics.pdf")} />
      </div>
      {!list.length ? (
        <Empty icon="analytics" title={t("analytics.empty")} body={t("analytics.emptyHint")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={t("analytics.posts")} value={list.length} />
            <Stat label={t("analytics.reach")} value={total("reach").toLocaleString()} change={change("reach")} />
            <Stat label={t("analytics.likes")} value={total("likes").toLocaleString()} change={change("likes")} />
            <Stat label={t("analytics.comments")} value={total("comments").toLocaleString()} change={change("comments")} />
            <Stat label={t("analytics.shares")} value={total("shares").toLocaleString()} change={change("shares")} />
          </div>
          {insights.length > 0 && (
            <Card title={t("more.analytics.insights")}>
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {insights.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t("analytics.best")}>
              <ul className="divide-y divide-border">
                {best.map((p) => {
                  const cv = cover(p);
                  const m = p.post_metrics;
                  return (
                    <li key={p.id}>
                      <Link href={`/posts/${p.id}`} className="flex items-center gap-3 py-2">
                        {cv && (
                          // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                          <img src={urls.get(cv)} alt="" className="size-11 rounded-md object-cover" />
                        )}
                        <p className="min-w-0 grow truncate text-sm">{p.caption_ar || p.caption_en}</p>
                        <span className="shrink-0 text-xs text-muted">
                          ♡ {m.reduce((a, x) => a + x.likes, 0)} · 💬 {m.reduce((a, x) => a + x.comments, 0)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card title={t("analytics.byCategory")}>
              {!byCat.length && <p className="text-sm text-muted">{t("analytics.noCategories")}</p>}
              <ul className="space-y-2">
                {byCat.sort((a, b) => b.avg - a.avg).map(({ c, count, avg }) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex justify-between">
                      <span>{categoryName(c as { name_ar: string; name_en: string }, locale)}</span>
                      <span className="text-xs text-muted">{t("analytics.avg", { avg: Math.round(avg), count })}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-grey-bg">
                      <div className="h-full rounded-full" style={{ width: `${(avg / maxCat) * 100}%`, background: c.color as string }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t("analytics.bestTime")}>
              <p className="mb-3 text-sm text-muted">{bestHour ? t("analytics.bestHour", { hour: `${bestHour.h}:00` }) : t("analytics.needMore")}</p>
              <div className="flex h-28 items-end gap-0.5">
                {hours.map((x) => (
                  <div key={x.h} className="flex grow flex-col items-center gap-1" title={`${x.h}:00 · ${x.count}`}>
                    <div className={`w-full rounded-t ${x === bestHour ? "bg-accent" : "bg-accent/30"}`} style={{ height: `${Math.max(2, (x.avg / maxHour) * 96)}px` }} />
                    {x.h % 6 === 0 && <span className="text-[9px] text-faint">{x.h}</span>}
                  </div>
                ))}
              </div>
            </Card>
            <Card title={t("analytics.followers")}>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Facebook" value={(fb[fb.length - 1]?.followers as number | undefined)?.toLocaleString() ?? "—"} hint={growth(fb) !== null ? t("analytics.growth", { n: growth(fb)! }) : undefined} />
                <Stat label="Instagram" value={(ig[ig.length - 1]?.followers as number | undefined)?.toLocaleString() ?? "—"} hint={growth(ig) !== null ? t("analytics.growth", { n: growth(ig)! }) : undefined} />
              </div>
              {(growth(fb) !== null || growth(ig) !== null) && (
                <p className="mt-2 text-xs text-muted">
                  {[growth(fb) !== null && `Facebook ${t("analytics.growth", { n: growth(fb)! })}`, growth(ig) !== null && `Instagram ${t("analytics.growth", { n: growth(ig)! })}`].filter(Boolean).join(" · ")}
                </p>
              )}
            </Card>
          </div>
          <Card title={t("more.analytics.history")}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 text-start font-semibold">{t("more.analytics.month")}</th>
                    <th className="text-end font-semibold">{t("analytics.posts")}</th>
                    <th className="text-end font-semibold">{t("analytics.reach")}</th>
                    <th className="text-end font-semibold">{t("analytics.likes")}</th>
                    <th className="text-end font-semibold">{t("analytics.comments")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {months.map((r) => (
                    <tr key={r.m}>
                      <td className="py-1.5">{new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.m}-01T00:00:00Z`))}</td>
                      <td className="text-end">{r.posts}</td>
                      <td className="text-end">{r.reach.toLocaleString()}</td>
                      <td className="text-end">{r.likes.toLocaleString()}</td>
                      <td className="text-end">{r.comments.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </AppShell>
  );
}
