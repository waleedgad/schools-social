import { getTranslations, setRequestLocale } from "next-intl/server";
import { CalendarGrid, type CalDay } from "@/components/calendar-grid";
import { AppShell } from "@/components/shell";
import { Button, ButtonLink, Card, Notice, Select } from "@/components/ui";
import { makeCountdown } from "@/lib/actions/posts";
import { Link, redirect } from "@/i18n/navigation";
import { thumbPath } from "@/lib/images";
import { categoryName, isPaused, type Slot } from "@/lib/posting";
import { signedThumbs } from "@/lib/posts";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string;
  status: string;
  caption_ar: string | null;
  caption_en: string | null;
  idea: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  due_on: string | null;
  category_id: string | null;
  countdown_to: string | null;
  post_photos: { position: number; photo: { storage_path: string; edited_path: string | null } | null }[];
};

// Days are worked out in the school's time zone, so a post at 11pm Cairo
// time sits on the right day whatever the server's clock says.
function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function timeOf(iso: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ month?: string; week?: string; day?: string; year?: string; view?: string; spread?: string; countdown?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  const perms = membership.school.permissions;
  if (!can(membership.role, "viewPosts", perms)) redirect({ href: "/today", locale });

  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const timeZone = membership.school.timezone || "Africa/Cairo";
  const sp = await searchParams;
  const view = (["week", "day", "list", "overview"] as const).find((v) => v === sp.view) ?? "month";
  const today = dayKey(new Date().toISOString(), timeZone);

  // The visible range: a month (Saturday-first weeks, as in Egyptian
  // schools) or a single week.
  let start: Date;
  let count: number;
  let label: string;
  let prev: Record<string, string>;
  let next: Record<string, string>;
  const fmt = (opts: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { ...opts, timeZone: "UTC" }).format(d);
  if (view === "day") {
    start = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? new Date(`${sp.day}T00:00:00Z`) : new Date(`${today}T00:00:00Z`);
    count = 1;
    label = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, start);
    prev = { view, day: iso(new Date(start.getTime() - 86400_000)) };
    next = { view, day: iso(new Date(start.getTime() + 86400_000)) };
  } else if (view === "overview") {
    const y = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : Number(today.slice(0, 4));
    start = new Date(Date.UTC(y, 0, 1));
    count = Math.round((Date.UTC(y + 1, 0, 1) - start.getTime()) / 86400_000);
    label = String(y);
    prev = { view, year: String(y - 1) };
    next = { view, year: String(y + 1) };
  } else if (view === "week") {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? new Date(`${sp.week}T00:00:00Z`) : new Date(`${today}T00:00:00Z`);
    start = new Date(base.getTime() - ((base.getUTCDay() + 1) % 7) * 86400_000);
    count = 7;
    label = `${fmt({ day: "numeric", month: "short" }, start)} – ${fmt({ day: "numeric", month: "short", year: "numeric" }, new Date(start.getTime() + 6 * 86400_000))}`;
    prev = { view, week: iso(new Date(start.getTime() - 7 * 86400_000)) };
    next = { view, week: iso(new Date(start.getTime() + 7 * 86400_000)) };
  } else {
    const [y, m] = (/^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : today.slice(0, 7)).split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    start = new Date(first.getTime() - ((first.getUTCDay() + 1) % 7) * 86400_000);
    const last = new Date(Date.UTC(y, m, 0));
    count = Math.ceil(((last.getTime() - start.getTime()) / 86400_000 + 1) / 7) * 7;
    label = fmt({ month: "long", year: "numeric" }, first);
    const shift = (delta: number) => {
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    };
    prev = { view, month: shift(-1) };
    next = { view, month: shift(1) };
  }
  const end = new Date(start.getTime() + count * 86400_000);
  const from = new Date(start.getTime() - 86400_000).toISOString();
  const to = new Date(end.getTime() + 86400_000).toISOString();

  const ly = (d: Date) => new Date(d.getTime() - 364 * 86400_000).toISOString();
  const [{ data: posts }, { data: categories }, { data: slots }, { data: events }, { data: school }, { data: repeats }, { data: lastYear }, { data: upcoming }] = await Promise.all([
    supabase
      .from("posts")
      .select("id, status, caption_ar, caption_en, idea, scheduled_at, published_at, due_on, category_id, countdown_to, post_photos(position, photo:photos(storage_path, edited_path))")
      .eq("school_id", schoolId)
      .or(`and(scheduled_at.gte.${from},scheduled_at.lt.${to}),and(published_at.gte.${from},published_at.lt.${to}),and(due_on.gte.${iso(start)},due_on.lt.${iso(end)})`)
      .returns<Row[]>(),
    supabase.from("categories").select("id, name_ar, name_en, color").eq("school_id", schoolId),
    supabase.from("time_slots").select("id, weekday, at_time, category_id, platforms").eq("school_id", schoolId).returns<Slot[]>(),
    supabase.from("events").select("id, title, event_date, ends_on, kind, photos_expected").eq("school_id", schoolId).gte("event_date", iso(new Date(start.getTime() - 30 * 86400_000))).lt("event_date", iso(end)),
    supabase.from("schools").select("posting_paused_until, term_dates, holidays, no_post_days").eq("id", schoolId).single(),
    supabase.from("events").select("id, title, event_date, kind").eq("school_id", schoolId).eq("repeat_yearly", true).lt("event_date", iso(start)).limit(200),
    supabase.from("posts").select("id, caption_ar, caption_en, published_at").eq("school_id", schoolId).eq("status", "published").gte("published_at", ly(start)).lt("published_at", ly(end)).limit(100),
    supabase.from("events").select("id, title, event_date").eq("school_id", schoolId).gte("event_date", today).order("event_date").limit(30),
  ]);
  // Events made "every year" show on this year's date too.
  const shifted = (repeats ?? []).flatMap((e) => {
    const md = (e.event_date as string).slice(4);
    return [iso(start).slice(0, 4), iso(end).slice(0, 4)].map((y) => ({ ...e, event_date: `${y}${md}`, ends_on: null, photos_expected: false, repeat: true }));
  }).filter((e, i, a) => e.event_date >= iso(start) && e.event_date < iso(end) && a.findIndex((x) => x.id === e.id && x.event_date === e.event_date) === i);
  const allEvents = [...(events ?? []), ...shifted];
  const holidays = ((school?.holidays ?? []) as { name: string; start: string; end: string }[]);
  const noPost = ((school?.no_post_days ?? {}) as { weekdays?: number[]; holidays?: boolean });
  const holidayOn = (k: string) => holidays.find((h) => h.start <= k && (h.end || h.start) >= k) ?? null;

  const cover = (p: Row) => {
    const f = [...p.post_photos].sort((a, b) => a.position - b.position)[0]?.photo;
    return f ? thumbPath(f.edited_path ?? f.storage_path) : null;
  };
  const urls = await signedThumbs(supabase, (posts ?? []).map(cover).filter(Boolean) as string[]);
  const cats = new Map((categories ?? []).map((c) => [c.id as string, c]));
  const terms = ((school?.term_dates ?? []) as { name: string; start: string; end: string }[]);

  const days: CalDay[] = Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400_000);
    const key = iso(d);
    const dayPosts = (posts ?? []).filter((p) => {
      const when = p.published_at ?? p.scheduled_at;
      return when ? dayKey(when, timeZone) === key : p.due_on === key;
    });
    const used = new Set(dayPosts.map((p) => (p.scheduled_at ? timeOf(p.scheduled_at, timeZone, "en") : "")));
    return {
      key,
      day: d.getUTCDate(),
      inMonth: view === "week" || view === "day" || view === "overview" || (sp.month ? key.slice(0, 7) === sp.month : key.slice(0, 7) === today.slice(0, 7)),
      today: key === today,
      past: key < today,
      events: allEvents
        .filter((e) => e.event_date === key || (e.ends_on && e.event_date <= key && e.ends_on >= key))
        .map((e) => ({ id: e.id as string, title: e.title as string, kind: e.kind as string, photos: !!e.photos_expected, repeat: "repeat" in e })),
      holiday: holidayOn(key)?.name ?? null,
      noPost: (noPost.weekdays ?? []).includes(d.getUTCDay()) || (noPost.holidays !== false && !!holidayOn(key)),
      lastYear: (lastYear ?? []).filter((p) => dayKey(new Date(Date.parse(p.published_at as string) + 364 * 86400_000).toISOString(), timeZone) === key).map((p) => ({ id: p.id as string, text: ((p.caption_ar || p.caption_en || "") as string).slice(0, 80) })),
      term: terms.find((tm) => tm.start === key)?.name ?? null,
      posts: dayPosts
        .sort((a, b) => Date.parse(a.scheduled_at ?? a.published_at ?? "") - Date.parse(b.scheduled_at ?? b.published_at ?? ""))
        .map((p) => {
          const c = p.category_id ? cats.get(p.category_id) : null;
          const cv = cover(p);
          const when = p.published_at ?? p.scheduled_at;
          return {
            id: p.id,
            status: p.status,
            text: p.caption_ar || p.caption_en || p.idea || "",
            time: when ? timeOf(when, timeZone, locale) : null,
            cover: cv ? urls.get(cv) ?? null : null,
            color: (c?.color as string) ?? null,
            category: c ? categoryName(c as { name_ar: string; name_en: string }, locale) : null,
            categoryId: p.category_id,
            countdown: p.countdown_to ? Math.round((Date.parse(`${p.countdown_to}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / 86400_000) : null,
          };
        }),
      // Empty slots show as dashed "post here" spots.
      slots: (slots ?? [])
        .filter((s) => s.weekday === d.getUTCDay() && !used.has(s.at_time.slice(0, 5)) && !((noPost.weekdays ?? []).includes(d.getUTCDay()) || (noPost.holidays !== false && !!holidayOn(key))))
        .map((s) => {
          const c = s.category_id ? cats.get(s.category_id) : null;
          return { time: s.at_time.slice(0, 5), category: c ? categoryName(c as { name_ar: string; name_en: string }, locale) : null, color: (c?.color as string) ?? null };
        }),
    };
  });

  // Gaps: three or more school days in a row ahead with posting times and no post.
  const gaps: string[][] = [];
  let run: string[] = [];
  for (const d of days.filter((x) => !x.past && x.inMonth)) {
    if (d.noPost) continue;
    if (!d.posts.length && d.slots.length) run.push(d.key);
    else {
      if (run.length >= 3) gaps.push(run);
      run = [];
    }
  }
  if (run.length >= 3) gaps.push(run);
  // Events where photos were expected in the last 30 days and none came in.
  const expected = (events ?? []).filter((e) => e.photos_expected && e.event_date < today && e.event_date >= iso(new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400_000)));
  const { data: withPhotos } = expected.length ? await supabase.from("photos").select("event_id").in("event_id", expected.map((e) => e.id as string)).limit(1000) : { data: [] };
  const have = new Set((withPhotos ?? []).map((r) => r.event_id as string));
  const photosMissing = expected.filter((e) => !have.has(e.id as string));
  // Each week's category mix.
  const weeks = Array.from({ length: view === "day" || view === "overview" ? 0 : count / 7 }, (_, w) => {
    const list = days.slice(w * 7, w * 7 + 7).flatMap((d) => d.posts);
    const mix = new Map<string, { color: string; name: string; n: number }>();
    for (const p of list) if (p.categoryId && p.color) mix.set(p.categoryId, { color: p.color, name: p.category ?? "", n: (mix.get(p.categoryId)?.n ?? 0) + 1 });
    return { from: days[w * 7].key, total: list.length, mix: [...mix.values()] };
  });

  const weekdays = Array.from({ length: 7 }, (_, i) => fmt({ weekday: "short" }, new Date(Date.UTC(2026, 0, 3 + i))));
  const canWrite = can(membership.role, "writePosts", perms);

  return (
    <AppShell
      locale={locale}
      membership={membership}
      workspaces={workspaces}
      active="calendar"
      title={t("calendar.title")}
      subtitle={label}
      actions={
        <div className="flex items-center gap-1">
          <ButtonLink href={{ pathname: "/calendar", query: prev }} variant="ghost" className="!px-2">‹</ButtonLink>
          <ButtonLink href={{ pathname: "/calendar", query: { view } }} variant="quiet" className="!px-2.5 !py-1.5 text-xs">{t("calendar.today")}</ButtonLink>
          <ButtonLink href={{ pathname: "/calendar", query: next }} variant="ghost" className="!px-2">›</ButtonLink>
          <div className="ms-1 flex rounded-lg border border-border bg-surface p-0.5">
            {(["day", "week", "month", "list", "overview"] as const).map((v) => (
              <ButtonLink key={v} href={{ pathname: "/calendar", query: { view: v } }} variant={view === v ? "primary" : "ghost"} className="!px-2.5 !py-1 text-xs">
                {t(`calendar.views.${v}`)}
              </ButtonLink>
            ))}
          </div>
        </div>
      }
    >
      {sp.spread && <Notice tone="good">{t("calendar.spread", { count: Number(sp.spread) })}</Notice>}
      {school && isPaused(school) && <Notice tone="warn">{t("calendar.paused")}</Notice>}
      {sp.countdown && <Notice tone="good">{t("more.calendar.countdownMade", { count: Number(sp.countdown) })}</Notice>}
      {photosMissing.map((e) => <Notice key={e.id as string} tone="warn">📷 {t("more.calendar.photosMissing", { title: e.title as string })}</Notice>)}
      {canWrite && gaps.map((g) => (
        <Notice key={g[0]} tone="info">{t("more.calendar.gap", { from: fmt({ weekday: "short", day: "numeric", month: "short" }, new Date(`${g[0]}T00:00:00Z`)), to: fmt({ weekday: "short", day: "numeric", month: "short" }, new Date(`${g[g.length - 1]}T00:00:00Z`)), count: g.length })} <Link href="/posts" className="font-semibold underline">{t("more.calendar.makeWeek")}</Link></Notice>
      ))}
      {view === "list" ? (
        <Card className="!p-0">
          <ul className="divide-y divide-border">
            {days.filter((d) => d.inMonth && (d.posts.length || d.events.length || d.holiday || (!d.past && d.slots.length))).map((d) => (
              <li key={d.key} className={`flex gap-3 p-3 ${d.today ? "bg-accent-bg/40" : ""}`}>
                <Link href={{ pathname: "/calendar", query: { view: "day", day: d.key } }} className="w-24 shrink-0 text-sm">
                  <b className="block">{fmt({ weekday: "short", day: "numeric" }, new Date(`${d.key}T00:00:00Z`))}</b>
                  <span className="text-xs text-muted">{fmt({ month: "short" }, new Date(`${d.key}T00:00:00Z`))}</span>
                </Link>
                <div className="min-w-0 grow space-y-1 text-sm">
                  {d.holiday && <p className="text-xs text-muted">🏖 {d.holiday}</p>}
                  {d.events.map((e) => <p key={e.id} className="text-xs font-semibold text-warn">{e.photos && "📷 "}{e.repeat && "↻ "}{e.title}</p>)}
                  {d.posts.map((p) => (
                    <Link key={p.id} href={`/posts/${p.id}`} className="flex items-center gap-2 rounded-lg border border-border p-1.5 hover:border-accent" style={p.color ? { borderInlineStartColor: p.color, borderInlineStartWidth: 3 } : undefined}>
                      {p.cover && (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                        <img src={p.cover} alt="" className="size-9 shrink-0 rounded object-cover" />
                      )}
                      <span className="min-w-0 grow truncate">{p.time && <b className="me-1">{p.time}</b>}{p.text || t(`posts.status.${p.status}`)}</span>
                      <span className="shrink-0 text-xs text-muted">{t(`posts.status.${p.status}`)}</span>
                    </Link>
                  ))}
                  {canWrite && !d.past && d.slots.map((sl) => (
                    <Link key={sl.time} href={{ pathname: "/posts/new", query: { day: d.key } }} className="block rounded-lg border border-dashed border-border px-2 py-1 text-xs text-faint hover:border-accent hover:text-accent">
                      {sl.time} {sl.category ?? ""} · {t("more.calendar.noPostYet")}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : view === "overview" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }, (_, m) => {
            const inM = days.filter((d) => Number(d.key.slice(5, 7)) === m + 1);
            const list = inM.flatMap((d) => d.posts);
            const mix = new Map<string, { color: string; name: string; n: number }>();
            for (const p of list) if (p.categoryId && p.color) mix.set(p.categoryId, { color: p.color, name: p.category ?? "", n: (mix.get(p.categoryId)?.n ?? 0) + 1 });
            const posted = list.filter((p) => p.status === "published").length;
            const planned = list.length - posted;
            const evs = inM.reduce((a, d) => a + d.events.length, 0);
            const month = `${label}-${String(m + 1).padStart(2, "0")}`;
            return (
              <Link key={m} href={{ pathname: "/calendar", query: { view: "month", month } }} className="rounded-xl border border-border bg-surface p-3 hover:border-accent">
                <div className="flex items-baseline justify-between">
                  <b>{fmt({ month: "long" }, new Date(Date.UTC(2026, m, 1)))}</b>
                  <span className="text-xs text-muted">{t("more.calendar.posts", { count: list.length })}</span>
                </div>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-grey-bg">
                  {[...mix.values()].map((x) => <div key={x.name} title={`${x.name}: ${x.n}`} style={{ width: `${(x.n / Math.max(1, list.length)) * 100}%`, background: x.color }} />)}
                </div>
                <p className="mt-2 text-xs text-muted">{t("more.calendar.overviewLine", { posted, planned, events: evs })}</p>
              </Link>
            );
          })}
        </div>
      ) : (
        <CalendarGrid locale={locale} days={days} weekdays={weekdays} view={view === "day" ? "day" : view} canWrite={canWrite} />
      )}
      {weeks.length > 0 && <Card title={t("more.calendar.balance")}>
        <ul className="space-y-1.5">
          {weeks.map((w) => (
            <li key={w.from} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-muted">{fmt({ day: "numeric", month: "short" }, new Date(`${w.from}T00:00:00Z`))}</span>
              <div className="flex h-2.5 grow overflow-hidden rounded-full bg-grey-bg">
                {w.mix.map((m) => <div key={m.name} title={`${m.name}: ${m.n}`} style={{ width: `${(m.n / Math.max(1, w.total)) * 100}%`, background: m.color }} />)}
              </div>
              <span className="w-16 shrink-0 text-end text-muted">{t("more.calendar.posts", { count: w.total })}</span>
            </li>
          ))}
        </ul>
      </Card>}
      {canWrite && (upcoming ?? []).length > 0 && (
        <Card title={t("more.calendar.countdown")}>
          <form action={makeCountdown} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="locale" value={locale} />
            <div className="min-w-56 grow">
              <Select label={t("more.calendar.countdownEvent")} name="event" required defaultValue="">
                <option value="" disabled>{t("newPost.pickEvent")}</option>
                {(upcoming ?? []).map((e) => <option key={e.id as string} value={e.id as string}>{e.title as string} · {e.event_date as string}</option>)}
              </Select>
            </div>
            <fieldset className="flex items-center gap-3 text-sm">
              {[14, 7, 3, 1].map((n) => (
                <label key={n} className="flex items-center gap-1"><input type="checkbox" name="days" value={n} defaultChecked={n === 7 || n === 3 || n === 1} />{t("more.calendar.daysBefore", { count: n })}</label>
              ))}
            </fieldset>
            <Button icon="clock" variant="quiet">{t("more.calendar.makeCountdown")}</Button>
          </form>
        </Card>
      )}
    </AppShell>
  );
}
