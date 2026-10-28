import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/shell";
import { Button, ButtonLink, Card, Chip, Empty, Notice, Stat } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { saveToday } from "@/lib/actions/prefs";
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
];
const DEFAULTS: Record<string, string[]> = {
  admin: ["approvals", "next", "problems", "numbers", "balance", "waitingMac"],
  comms_lead: ["approvals", "next", "problems", "ideas", "balance", "waitingMac", "numbers"],
  comms: ["next", "ideas", "problems", "waitingMac", "balance"],
  principal: ["extra", "next", "numbers"],
  teacher: ["upload", "mine"],
  staff: ["upload", "mine"],
  photographer: ["upload", "mine"],
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
  const chosen = ((prefs?.today as string[] | undefined)?.length ? (prefs!.today as string[]) : DEFAULTS[membership.role] ?? []).filter((k) => allowed.includes(k));
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

  const allPosts = [approvals, extra, next, ideas, problems].flatMap((r) => r?.data ?? []);
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

  const blocks: Record<string, ReactNode> = {
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
