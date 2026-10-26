import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Link, redirect } from "@/i18n/navigation";
import { STATUS_STYLE } from "@/lib/post-status";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = { id: string; status: string; caption_ar: string | null; caption_en: string | null; scheduled_at: string | null; published_at: string | null };

// Days are worked out in the school's time zone, so a post at 11pm Cairo
// time sits on the right day whatever the server's clock says.
function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership } = await requireMembership(locale);
  if (!can(membership.role, "writePosts")) redirect({ href: "/dashboard", locale });

  const t = await getTranslations();
  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("timezone").eq("id", membership.school.id).single();
  const timeZone = school?.timezone ?? "Africa/Cairo";

  const { month } = await searchParams;
  const today = dayKey(new Date().toISOString(), timeZone);
  const [y, m] = (/^\d{4}-\d{2}$/.test(month ?? "") ? month! : today.slice(0, 7)).split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startPad = (first.getUTCDay() + 1) % 7; // weeks start on Saturday, as in Egyptian schools
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  // A little extra on both sides covers time zone edges.
  const from = new Date(Date.UTC(y, m - 1, 0)).toISOString();
  const to = new Date(Date.UTC(y, m, 2)).toISOString();
  const { data: posts } = await supabase
    .from("posts")
    .select("id, status, caption_ar, caption_en, scheduled_at, published_at")
    .eq("school_id", membership.school.id)
    .or(`and(scheduled_at.gte.${from},scheduled_at.lt.${to}),and(published_at.gte.${from},published_at.lt.${to})`)
    .returns<Row[]>();

  const byDay = new Map<string, Row[]>();
  for (const p of posts ?? []) {
    const when = p.published_at ?? p.scheduled_at;
    if (!when) continue;
    const key = dayKey(when, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }

  const monthName = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 3 + i))),
  );
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody wide>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("calendar.title")}</h1>
          <div className="flex items-center gap-4 text-sm">
            <Link href={{ pathname: "/calendar", query: { month: shift(-1) } }} className="text-accent">
              {t("calendar.previous")}
            </Link>
            <span className="font-semibold">{monthName}</span>
            <Link href={{ pathname: "/calendar", query: { month: shift(1) } }} className="text-accent">
              {t("calendar.next")}
            </Link>
            <Link href="/posts" className="text-accent hover:underline">
              {t("dashboard.sections.posts")}
            </Link>
          </div>
        </div>
        <p className="text-sm text-muted">{t("calendar.hint", { timeZone })}</p>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {weekdays.map((w) => (
            <div key={w} className="px-1 py-2 text-center font-semibold text-muted">
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (!day) return <div key={`pad-${i}`} />;
            const key = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const items = byDay.get(key) ?? [];
            return (
              <div key={key} className={`min-h-24 space-y-1 rounded-lg border bg-surface p-1 ${key === today ? "border-accent" : "border-border"}`}>
                <div className="text-end text-muted">{day}</div>
                {items.map((p) => (
                  <Link key={p.id} href={`/posts/${p.id}`} className={`block truncate rounded px-1 py-0.5 ${STATUS_STYLE[p.status]}`}>
                    {p.caption_ar || p.caption_en || t("posts.noCaption")}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
