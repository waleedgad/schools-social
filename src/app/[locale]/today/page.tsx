import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/shell";
import { Button, ButtonLink, Card, Chip, Empty, Notice, Stat } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { saveToday } from "@/lib/actions/prefs";
import { readAlert, remindPost } from "@/lib/actions/team";
import { isComms } from "@/lib/roles";
import { classScope } from "@/lib/team";
import { thumbPath } from "@/lib/images";
import { categoryName, isPaused, STATUS_TONE, type PostStatus } from "@/lib/posting";
import { signedThumbs } from "@/lib/posts";
import { can, type Permission } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { SETUP_STEPS, setupState } from "@/lib/setup";
import { createClient } from "@/lib/supabase/server";

// Every section Today can show, and who may see it. People pick and order
// their own; new people get the defaults for their role.
const SECTIONS: { key: string; permission: Permission }[] = [
  { key: "approvals", permission: "approvePosts" },
  { key: "extra", permission: "extraApprove" },
  { key: "next", permission: "viewPosts" },
  { key: "ideas", permission: "writePosts" },
  { key: "problems", permission: "writePosts" },
  { key: "waitingMac", permission: "viewLibrary" },
  { key: "balance", permission: "writePosts" },
  { key: "numbers", permission: "viewAnalytics" },
  { key: "upload", permission: "upload" },
  { key: "mine", permission: "upload" },
  { key: "plan", permission: "viewPosts" },
  { key: "progress", permission: "writePosts" },
  { key: "waiting", permission: "viewPosts" },
  { key: "occasions", permission: "viewPosts" },
  { key: "alerts", permission: "upload" },
  { key: "checks", permission: "upload" },
  { key: "coverage", permission: "viewCoverage" },
  { key: "inbox", permission: "writePosts" },
];
// The same cards as Today on the Mac, under the Mac's names, so a layout
// saved on one shows the same on the other.
const WEB_FOR_MAC: Record<string, string> = { week: "next", results: "numbers" };
const DEFAULTS: Record<string, string[]> = {
  admin: ["plan", "approvals", "problems", "next", "waiting", "numbers", "progress", "balance", "occasions", "alerts", "waitingMac"],
  comms_lead: ["plan", "approvals", "problems", "next", "waiting", "progress", "ideas", "balance", "occasions", "alerts", "waitingMac", "numbers"],
  comms: ["plan", "problems", "next", "ideas", "progress", "occasions", "alerts", "waitingMac", "balance"],
  principal: ["extra", "next", "waiting", "numbers", "occasions"],
  teacher: ["checks", "upload", "coverage", "mine", "alerts"],
  staff: ["checks", "upload", "mine"],
  photographer: ["checks", "upload", "mine"],
};

type PostRow = { id: string; status: string; caption_ar: string | null; caption_en: string | null; idea: string | null; scheduled_at: string | null; due_on: string | null; publish_error: string | null; category_id: string | null; post_photos: { position: number; photo: { storage_path: string; edited_path: string | null } | null }[] };

export default async function TodayPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership, workspaces } = await requireMembership(locale);
  const { edit } = await searchParams;
  const perms = membership.school.permissions;
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const allowed = SECTIONS.filter((s) => can(membership.role, s.permission, perms)).map((s) => s.key);

  const { data: prefs } = await supabase.from("user_prefs").select("today").eq("user_id", user.id).eq("school_id", schoolId).maybeSingle();
  const saved = ((prefs?.today as string[] | undefined) ?? []).map((k) => WEB_FOR_MAC[k] ?? k);
  const chosen = [...new Set(saved.length ? saved : DEFAULTS[membership.role] ?? [])].filter((k) => allowed.includes(k));
  const want = new Set(chosen);

  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400_000).toISOString();
  const cols = "id, status, caption_ar, caption_en, idea, scheduled_at, due_on, publish_error, category_id, post_photos(position, photo:photos(storage_path, edited_path))";
  const [approvals, extra, next, ideas, problems, waiting, recent, mine, school, cats, metrics] = await Promise.all([
    want.has("approvals") ? supabase.from("posts").select(cols).eq("school_id", schoolId).eq("status", "in_review").order("updated_at").limit(8).returns<PostRow[]>() : null,
    want.has("extra") ? supabase.from("posts").select(cols).eq("school_id", schoolId).eq("status", "waiting_extra").order("sent_extra_at").limit(8).returns<PostRow[]>() : null,
    want.has("next") ? supabase.from("posts").select(cols).eq("school_id", schoolId).in("status", ["scheduled", "approved"]).gte("scheduled_at", now.toISOString()).lte("scheduled_at", week).order("scheduled_at").limit(8).returns<PostRow[]>() : null,
    want.has("ideas") ? supabase.from("posts").select(cols).eq("school_id", schoolId).eq("status", "idea").order("due_on", { nullsFirst: false }).limit(6).returns<PostRow[]>() : null,
    want.has("problems") ? supabase.from("posts").select(cols).eq("school_id", schoolId).in("status", ["failed", "rejected"]).order("updated_at", { ascending: false }).limit(6).returns<PostRow[]>() : null,
    want.has("waitingMac") ? supabase.from("photos").select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("check_status", "waiting") : null,
    want.has("balance") ? supabase.from("posts").select("category_id").eq("school_id", schoolId).in("status", ["published", "scheduled", "approved"]).gte("updated_at", new Date(now.getTime() - 30 * 86400_000).toISOString()) : null,
    want.has("mine") ? supabase.from("photos").select("id, storage_path, edited_path, check_status, contains_opted_out, created_at").eq("school_id", schoolId).eq("uploaded_by", user.id).order("created_at", { ascending: false }).limit(12) : null,
    supabase.from("schools").select("posting_paused_until, pause_reason").eq("id", schoolId).single(),
    supabase.from("categories").select("id, name_ar, name_en, color").eq("school_id", schoolId).order("position"),
    want.has("numbers") ? supabase.from("post_metrics").select("likes, comments, shares, reach, fetched_at").eq("school_id", schoolId).gte("fetched_at", new Date(now.getTime() - 30 * 86400_000).toISOString()) : null,
  ]);

  const today = now.toLocaleDateString("en-CA", { timeZone: membership.school.timezone });
  const inDays = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  const weekStart = inDays(-new Date(`${today}T12:00:00Z`).getUTCDay());
  const scope = want.has("checks") || want.has("coverage") ? await classScope(supabase, schoolId, user.id, membership.role) : null;
  const [waitingPosts, slots, weekPosts, upcoming, repeats, alerts, faceChecks, shotLists, books, cov] = await Promise.all([
    want.has("waiting") ? supabase.from("posts").select(cols + ", updated_at, sent_extra_at").eq("school_id", schoolId).in("status", ["in_review", "waiting_extra"]).lt("updated_at", new Date(now.getTime() - 86400_000).toISOString()).order("updated_at").limit(8).returns<(PostRow & { updated_at: string; sent_extra_at: string | null })[]>() : null,
    want.has("plan") || want.has("progress") ? supabase.from("time_slots").select("weekday, at_time, category_id").eq("school_id", schoolId) : null,
    want.has("plan") || want.has("progress") ? supabase.from("posts").select("id, status, scheduled_at").eq("school_id", schoolId).gte("scheduled_at", `${weekStart}T00:00:00Z`).lt("scheduled_at", `${inDays(7 - new Date(`${today}T12:00:00Z`).getUTCDay())}T00:00:00Z`).neq("status", "rejected") : null,
    want.has("occasions") || want.has("plan") ? supabase.from("events").select("id, title, event_date, kind, shot_list").eq("school_id", schoolId).gte("event_date", today).lte("event_date", inDays(30)).order("event_date").limit(20) : null,
    want.has("occasions") ? supabase.from("events").select("id, title, event_date, kind").eq("school_id", schoolId).eq("repeat_yearly", true).lt("event_date", today).limit(100) : null,
    want.has("alerts") ? supabase.from("team_alerts").select("id, kind, body, created_at, read_by").eq("school_id", schoolId).gte("created_at", new Date(now.getTime() - 7 * 86400_000).toISOString()).order("created_at", { ascending: false }).limit(8) : null,
    want.has("checks") || want.has("plan") ? (scope && !scope.all ? supabase.from("face_checks").select("id", { count: "exact", head: true }).eq("school_id", schoolId).is("answer", null).in("class_name", scope.classes.length ? scope.classes : ["-"]) : supabase.from("face_checks").select("id", { count: "exact", head: true }).eq("school_id", schoolId).is("answer", null)) : null,
    want.has("checks") ? supabase.from("events").select("id, title, event_date, shot_list").eq("school_id", schoolId).gte("event_date", inDays(-1)).lte("event_date", inDays(3)).neq("shot_list", "[]").limit(5) : null,
    want.has("checks") ? supabase.from("books").select("id, title, class_name, kind").eq("school_id", schoolId).eq("status", "review").limit(5) : null,
    want.has("coverage") && scope ? (scope.all ? supabase.from("student_coverage").select("good, posts, class_name").eq("school_id", schoolId).limit(5000) : supabase.from("student_coverage").select("good, posts, class_name").eq("school_id", schoolId).in("class_name", scope.classes.length ? scope.classes : ["-"]).limit(5000)) : null,
  ]);

  const allPosts = [approvals, extra, next, ideas, problems, waitingPosts].flatMap((r) => r?.data ?? []);
  const cover = (p: PostRow) => {
    const f = [...p.post_photos].sort((a, b) => a.position - b.position)[0]?.photo;
    return f ? thumbPath(f.edited_path ?? f.storage_path) : null;
  };
  const urls = await signedThumbs(supabase, [...(allPosts.map(cover).filter(Boolean) as string[]), ...(mine?.data ?? []).map((p) => thumbPath((p.edited_path ?? p.storage_path) as string))]);
  const catMap = new Map((cats.data ?? []).map((c) => [c.id as string, c]));
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: membership.school.timezone });

  const list = (rows: PostRow[] | null | undefined, emptyKey: string, extraInfo?: (p: PostRow) => ReactNode) =>
    !rows?.length ? (
      <p className="text-sm text-muted">{t(`today.empty.${emptyKey}`)}</p>
    ) : (
      <ul className="divide-y divide-border">
        {rows.map((p) => {
          const cv = cover(p);
          const c = p.category_id ? catMap.get(p.category_id) : null;
          return (
            <li key={p.id}>
              <Link href={`/posts/${p.id}`} className="flex items-center gap-3 py-2 hover:opacity-80">
                {cv ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                  <img src={urls.get(cv)} alt="" className="size-11 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-md bg-background text-faint">
                    <Icon name={p.status === "idea" ? "ideas" : "posts"} />
                  </span>
                )}
                <div className="min-w-0 grow">
                  <p className="truncate text-sm">{p.caption_ar || p.caption_en || p.idea || t("posts.noCaption")}</p>
                  <p className="truncate text-xs text-muted">
                    {c && <span style={{ color: c.color as string }}>{categoryName(c as { name_ar: string; name_en: string }, locale)} · </span>}
                    {extraInfo?.(p)}
                  </p>
                </div>
                <Chip tone={STATUS_TONE[p.status as PostStatus] ?? "grey"}>{t(`posts.status.${p.status}`)}</Chip>
              </Link>
            </li>
          );
        })}
      </ul>
    );

  // Category balance over the last 30 days (SocialBee-style warning).
  const counts = new Map<string, number>();
  for (const r of recent?.data ?? []) if (r.category_id) counts.set(r.category_id as string, (counts.get(r.category_id as string) ?? 0) + 1);
  const totalRecent = (recent?.data ?? []).length;
  const missing = (cats.data ?? []).filter((c) => !counts.get(c.id as string)).slice(0, 3);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  const m = metrics?.data ?? [];
  const sum = (k: "likes" | "comments" | "shares" | "reach") => m.reduce((a, r) => a + ((r[k] as number) ?? 0), 0);

  // This week's posting times and how many have a post.
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const slotsAll = slots?.data ?? [];
  const posted = weekPosts?.data ?? [];
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: membership.school.timezone });
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const d = inDays(i - weekday);
    const want = slotsAll.filter((x) => x.weekday === i).length;
    const have = posted.filter((p) => p.scheduled_at && dayKey(p.scheduled_at as string) === d).length;
    return { d, want, have };
  });
  const weekWant = perDay.reduce((n, x) => n + x.want, 0);
  const weekHave = perDay.reduce((n, x) => n + Math.min(x.have, x.want || x.have), 0);
  const todayEmpty = Math.max(0, perDay[weekday].want - perDay[weekday].have);
  // Occasions coming up, and yearly ones moved to this year.
  const coming = [
    ...(upcoming?.data ?? []).filter((e) => e.kind === "occasion" || e.kind === "holiday" || e.kind === "event" || e.kind === "sport" || e.kind === "trip"),
    ...(repeats?.data ?? []).map((e) => ({ ...e, event_date: `${today.slice(0, 4)}${(e.event_date as string).slice(4)}` })).filter((e) => e.event_date >= today && e.event_date <= inDays(30)),
  ].sort((a, b) => (a.event_date as string).localeCompare(b.event_date as string)).slice(0, 8);
  const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const covRows = cov?.data ?? [];
  const alertText = (a: { kind: string; body: Record<string, unknown> }) =>
    a.kind === "import" ? t("today.alert.import", { count: Number(a.body.count) || 0, title: String(a.body.title ?? ""), by: String(a.body.by ?? "") })
    : a.kind === "book" ? t("today.alert.book", { title: String(a.body.title ?? "") })
    : a.body.assigned ? t("today.alert.assigned", { by: String(a.body.by ?? "") })
    : t("today.alert.remind", { from: String(a.body.from ?? ""), text: String(a.body.text ?? "") });

  const blocks: Record<string, ReactNode> = {
    plan: (
      <Card title={t("today.sections.plan")}>
        <ul className="space-y-1.5 text-sm">
          {approvals?.data?.length ? <li><Link href="/posts" className="flex items-center gap-2 hover:underline"><Icon name="check" className="text-accent" />{t("today.plan.approve", { count: approvals.data.length })}</Link></li> : null}
          {todayEmpty > 0 && <li><Link href={{ pathname: "/posts/new", query: { day: today } }} className="flex items-center gap-2 hover:underline"><Icon name="plus" className="text-accent" />{t("today.plan.empty", { count: todayEmpty })}</Link></li>}
          {faceChecks?.count ? <li><Link href="/check" className="flex items-center gap-2 hover:underline"><Icon name="face" className="text-accent" />{t("today.plan.faces", { count: faceChecks.count })}</Link></li> : null}
          {(upcoming?.data ?? []).filter((e) => e.event_date === today).map((e) => <li key={e.id as string}><Link href={((e.shot_list as unknown[]) ?? []).length ? `/shots/${e.id}` : { pathname: "/posts/new", query: { event: e.id as string } }} className="flex items-center gap-2 hover:underline"><Icon name="camera" className="text-accent" />{t("today.plan.event", { title: e.title as string })}</Link></li>)}
          {problems?.data?.length ? <li className="flex items-center gap-2 text-danger"><Icon name="warning" />{t("today.plan.problems", { count: problems.data.length })}</li> : null}
        </ul>
        {!approvals?.data?.length && !todayEmpty && !faceChecks?.count && !problems?.data?.length && !(upcoming?.data ?? []).some((e) => e.event_date === today) && <p className="text-sm text-muted">{t("today.plan.nothing")}</p>}
      </Card>
    ),
    progress: (
      <Card title={t("today.sections.progress")} action={<span className="text-xs text-muted">{t("today.progress.count", { have: weekHave, want: weekWant })}</span>}>
        {!weekWant ? (
          <p className="text-sm text-muted">{t("today.progress.noSlots")} <Link href="/categories" className="font-semibold underline">{t("today.progress.setSlots")}</Link></p>
        ) : (
          <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
            {perDay.map((x, i) => (
              <Link key={x.d} href={{ pathname: "/calendar", query: { view: "week", day: x.d } }} className={`rounded-md border p-1 ${i === weekday ? "border-accent" : "border-border"}`}>
                <span className="block text-muted">{dayName(x.d).split(" ")[0]}</span>
                <b className={x.want && x.have < x.want ? "text-warn" : "text-good"}>{x.want ? `${Math.min(x.have, x.want)}/${x.want}` : x.have || "–"}</b>
              </Link>
            ))}
          </div>
        )}
      </Card>
    ),
    waiting: (
      <Card title={t("today.sections.waiting")}>
        {list(waitingPosts?.data, "waiting", (p) => {
          const w = p as PostRow & { updated_at: string; sent_extra_at: string | null };
          const hours = Math.round((now.getTime() - Date.parse(w.sent_extra_at ?? w.updated_at)) / 3600_000);
          return t("today.waitingFor", { hours });
        })}
        {isComms(membership.role) && (waitingPosts?.data ?? []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(waitingPosts?.data ?? []).slice(0, 4).map((p, i) => (
              <form key={p.id} action={remindPost}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="id" value={p.id} />
                <Button variant="quiet" icon="bell" className="!px-2 !py-1 text-xs">{t("today.remind", { n: i + 1 })}</Button>
              </form>
            ))}
          </div>
        )}
      </Card>
    ),
    occasions: (
      <Card title={t("today.sections.occasions")} action={<ButtonLink href="/calendar" variant="ghost" className="!px-2 !py-1 text-xs">{t("nav.calendar")}</ButtonLink>}>
        {!coming.length ? (
          <p className="text-sm text-muted">{t("today.empty.occasions")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {coming.map((e) => (
              <li key={`${e.id}${e.event_date}`} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted">{dayName(e.event_date as string)}</span>
                <span className="grow truncate">{e.title as string}</span>
                {e.kind === "occasion" || e.kind === "holiday" ? (
                  <ButtonLink href={{ pathname: "/posts/new/announcement", query: { title: e.title as string, day: e.event_date as string } }} variant="ghost" className="!px-2 !py-0.5 text-xs">{t("today.makePost")}</ButtonLink>
                ) : (
                  <ButtonLink href={{ pathname: "/posts/new", query: { event: e.id as string } }} variant="ghost" className="!px-2 !py-0.5 text-xs">{t("today.makePost")}</ButtonLink>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    alerts: (
      <Card title={t("today.sections.alerts")}>
        {!alerts?.data?.length ? (
          <p className="text-sm text-muted">{t("today.empty.alerts")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.data.map((a) => {
              const read = ((a.read_by as string[]) ?? []).includes(user.id);
              const body = (a.body ?? {}) as Record<string, unknown>;
              const href = a.kind === "book" && body.book ? `/books/${body.book}` : body.post ? `/posts/${body.post}` : a.kind === "import" ? "/library" : null;
              return (
                <li key={a.id as string} className={`flex items-center gap-2 py-1.5 text-sm ${read ? "text-muted" : ""}`}>
                  <Icon name={a.kind === "import" ? "upload" : a.kind === "book" ? "book" : "bell"} className={read ? "text-faint" : "text-accent"} />
                  {href ? <Link href={href} className="grow truncate hover:underline">{alertText({ kind: a.kind as string, body })}</Link> : <span className="grow truncate">{alertText({ kind: a.kind as string, body })}</span>}
                  {!read && (
                    <form action={readAlert}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="id" value={a.id as string} />
                      <button className="text-xs text-muted hover:text-foreground" title={t("today.markRead")}><Icon name="check" /></button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    ),
    checks: (
      <Card title={t("today.sections.checks")}>
        <ul className="space-y-1.5 text-sm">
          {faceChecks?.count ? <li><Link href="/check" className="flex items-center gap-2 font-semibold text-accent-ink hover:underline"><Icon name="face" />{t("today.plan.faces", { count: faceChecks.count })}</Link></li> : null}
          {(shotLists?.data ?? []).map((e) => <li key={e.id as string}><Link href={`/shots/${e.id}`} className="flex items-center gap-2 hover:underline"><Icon name="camera" className="text-accent" />{t("today.shotList", { title: e.title as string, day: dayName(e.event_date as string) })}</Link></li>)}
          {(books?.data ?? []).filter((b) => !scope || scope.all || !b.class_name || scope.classes.includes(b.class_name as string)).map((b) => <li key={b.id as string}><Link href={{ pathname: `/books/${b.id}`, query: { tab: "names" } }} className="flex items-center gap-2 hover:underline"><Icon name="book" className="text-accent" />{t("today.bookToCheck", { title: b.title as string })}</Link></li>)}
        </ul>
        {!faceChecks?.count && !shotLists?.data?.length && !books?.data?.length && <p className="text-sm text-muted">{t("today.empty.checks")}</p>}
      </Card>
    ),
    coverage: (
      <Card title={t("today.sections.coverage")} action={<ButtonLink href="/coverage" variant="ghost" className="!px-2 !py-1 text-xs">{t("today.seeAll")}</ButtonLink>}>
        {!covRows.length ? (
          <p className="text-sm text-muted">{t("today.empty.coverage")}</p>
        ) : (
          <p className="text-sm">{t("today.coverageLine", { none: covRows.filter((r) => !r.good).length, total: covRows.length, posts: covRows.filter((r) => !r.posts).length })}</p>
        )}
      </Card>
    ),
    inbox: (
      <Card title={t("today.sections.inbox")} action={<ButtonLink href="/inbox" variant="ghost" className="!px-2 !py-1 text-xs">{t("today.seeAll")}</ButtonLink>}>
        <p className="text-sm text-muted">{t("today.inboxHint")}</p>
      </Card>
    ),
    approvals: <Card title={t("today.sections.approvals")} action={<ButtonLink href="/posts" variant="ghost" className="!px-2 !py-1 text-xs">{t("today.seeAll")}</ButtonLink>}>{list(approvals?.data, "approvals")}</Card>,
    extra: <Card title={t("today.sections.extra")}>{list(extra?.data, "extra")}</Card>,
    next: <Card title={t("today.sections.next")} action={<ButtonLink href="/calendar" variant="ghost" className="!px-2 !py-1 text-xs">{t("nav.calendar")}</ButtonLink>}>{list(next?.data, "next", (p) => (p.scheduled_at ? fmt(p.scheduled_at) : ""))}</Card>,
    ideas: <Card title={t("today.sections.ideas")}>{list(ideas?.data, "ideas", (p) => (p.due_on ? `${t("board.due")} ${p.due_on}` : ""))}</Card>,
    problems: <Card title={t("today.sections.problems")}>{list(problems?.data, "problems", (p) => p.publish_error ?? "")}</Card>,
    waitingMac: (
      <Card title={t("today.sections.waitingMac")}>
        <p className="text-sm">{waiting?.count ? t("today.waitingMac", { count: waiting.count }) : t("today.empty.waitingMac")}</p>
      </Card>
    ),
    balance: (
      <Card title={t("today.sections.balance")}>
        {!totalRecent ? (
          <p className="text-sm text-muted">{t("today.empty.balance")}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-grey-bg">
              {[...counts.entries()].map(([id, n]) => (
                <div key={id} style={{ width: `${(n / totalRecent) * 100}%`, background: catMap.get(id)?.color as string }} title={categoryName(catMap.get(id) as { name_ar: string; name_en: string }, locale)} />
              ))}
            </div>
            {top && top[1] / totalRecent > 0.5 && <Notice tone="warn">{t("today.tooMuch", { name: categoryName(catMap.get(top[0]) as { name_ar: string; name_en: string }, locale) })}</Notice>}
            {missing.length > 0 && <p className="text-xs text-muted">{t("today.missing", { names: missing.map((c) => categoryName(c as { name_ar: string; name_en: string }, locale)).join("، ") })}</p>}
          </div>
        )}
      </Card>
    ),
    numbers: (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("analytics.reach")} value={sum("reach").toLocaleString()} />
        <Stat label={t("analytics.likes")} value={sum("likes").toLocaleString()} />
        <Stat label={t("analytics.comments")} value={sum("comments").toLocaleString()} />
        <Stat label={t("analytics.shares")} value={sum("shares").toLocaleString()} />
      </div>
    ),
    upload: (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <b>{t("today.uploadTitle")}</b>
            <p className="text-sm text-muted">{t("today.uploadHint")}</p>
          </div>
          <ButtonLink href="/upload" variant="primary" icon="upload">
            {t("nav.upload")}
          </ButtonLink>
        </div>
      </Card>
    ),
    mine: (
      <Card title={t("today.sections.mine")}>
        {!mine?.data?.length ? (
          <p className="text-sm text-muted">{t("today.empty.mine")}</p>
        ) : (
          <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {mine.data.map((p) => (
              <li key={p.id as string} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                <img src={urls.get(thumbPath((p.edited_path ?? p.storage_path) as string))} alt="" className="aspect-square w-full rounded-md object-cover" />
                <span className={`absolute inset-x-0 bottom-0 rounded-b-md px-1 text-center text-[9px] text-white ${p.contains_opted_out ? "bg-danger" : p.check_status === "waiting" ? "bg-warn" : "bg-good"}`}>
                  {t(p.contains_opted_out ? "today.photoNo" : p.check_status === "waiting" ? "today.photoWaiting" : "today.photoReady")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
  };

  const setup = can(membership.role, "manageCategories", perms) ? await setupState(supabase, schoolId) : null;

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: membership.school.timezone }).format(now));
  const greeting = t(hour < 12 ? "today.morning" : hour < 17 ? "today.afternoon" : "today.evening", { name: membership.fullName.split(" ")[0] });

  return (
    <AppShell
      locale={locale}
      membership={membership}
      workspaces={workspaces}
      active="today"
      title={greeting}
      subtitle={new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "full", timeZone: membership.school.timezone }).format(now)}
      actions={<ButtonLink href={{ pathname: "/today", query: edit ? {} : { edit: "1" } }} variant="ghost" icon="settings" className="!px-2"><span className="hidden sm:inline">{t("today.customise")}</span></ButtonLink>}
    >
      {school.data && isPaused(school.data) && (
        <Notice tone="warn">
          {t("today.paused", { until: fmt(school.data.posting_paused_until as string) })} {school.data.pause_reason ?? ""} <Link href="/accounts" className="font-semibold underline">{t("today.resume")}</Link>
        </Notice>
      )}
      {setup && setup.count < SETUP_STEPS.length && (
        <Link href="/setup" className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-bg p-3 text-sm text-accent-ink">
          <Icon name="sparkle" />
          <span className="grow font-semibold">{t("setup.banner", { done: setup.count, total: SETUP_STEPS.length })}</span>
          <Icon name="chevron" className="rtl:rotate-180" />
        </Link>
      )}
      {edit && (
        <Card title={t("today.customise")}>
          <form action={saveToday} className="space-y-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="known" value={allowed.join(",")} />
            <p className="text-xs text-muted">{t("today.customiseHint")}</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {allowed.map((k) => (
                <li key={k} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
                  <input type="checkbox" name="section" value={k} defaultChecked={want.has(k)} />
                  <span className="grow">{t(`today.sections.${k}`)}</span>
                  <input type="number" name={`order.${k}`} min={1} max={20} defaultValue={chosen.indexOf(k) + 1 || allowed.indexOf(k) + 10} className="w-14 rounded border border-border bg-surface-2 px-1 text-xs" aria-label={t("today.order")} />
                </li>
              ))}
            </ul>
            <Button>{t("common.save")}</Button>
          </form>
        </Card>
      )}
      {!chosen.length && <Empty title={t("today.nothing")} body={t("today.customiseHint")} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {chosen.map((k) => (
          <div key={k} className={k === "numbers" || k === "upload" ? "lg:col-span-2" : ""}>
            {blocks[k]}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
