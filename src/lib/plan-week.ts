import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAi, type SchoolProfile } from "./ai";

// "Make a week of posts", shared by the website and the Mac app. The AI
// plans ideas from upcoming events and the school's categories; then, in the
// school's own time zone, an idea on a no-posting day or holiday moves to the
// next open day, and a day that already has a post is marked taken, so
// pressing it twice never doubles the week.
const DAY = 86400_000;
const shift = (d: string, days: number) => new Date(Date.parse(`${d}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
export const dayIn = (tz: string, at: Date | string = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

type Holiday = { start?: string; end?: string };
export type WeekIdea = { day: number; date: string; title: string; idea: string; category: string; category_id: string | null; event_id: string | null; taken: boolean };

export async function planWeek(supabase: SupabaseClient, school: { id: string; name: string; timezone: string }, days: number): Promise<WeekIdea[]> {
  const today = dayIn(school.timezone || "Africa/Cairo");
  const until = shift(today, days + 14);
  const [{ data: events }, { data: categories }, { data: row }, { data: posts }] = await Promise.all([
    supabase.from("events").select("id, title, event_date").eq("school_id", school.id).gte("event_date", shift(today, -7)).lte("event_date", shift(today, days)).order("event_date"),
    supabase.from("categories").select("id, name_en").eq("school_id", school.id).order("position"),
    supabase.from("schools").select("profile, no_post_days, holidays").eq("id", school.id).single(),
    supabase
      .from("posts")
      .select("due_on, scheduled_at, status")
      .eq("school_id", school.id)
      .neq("status", "rejected")
      .or(`due_on.gte.${today},scheduled_at.gte.${today}`)
      .limit(500),
  ]);
  const plan = await getAi().planPosts({
    schoolName: school.name,
    days,
    events: (events ?? []).map((e) => `${e.event_date}: ${e.title}`),
    categories: (categories ?? []).map((c) => c.name_en as string),
    profile: (row?.profile ?? {}) as SchoolProfile,
  });

  const rules = (row?.no_post_days ?? {}) as { weekdays?: number[]; holidays?: boolean };
  const holidays = (Array.isArray(row?.holidays) ? row!.holidays : []) as Holiday[];
  const off = (d: string) =>
    (rules.weekdays ?? []).includes(weekday(d)) || (rules.holidays !== false && holidays.some((h) => h.start && h.start <= d && (h.end || h.start) >= d));
  const taken = new Set<string>();
  for (const p of posts ?? []) {
    if (p.due_on) taken.add(p.due_on as string);
    if (p.scheduled_at) taken.add(dayIn(school.timezone || "Africa/Cairo", p.scheduled_at as string));
  }
  const byName = new Map((categories ?? []).map((c) => [String(c.name_en).toLowerCase(), c.id as string]));
  const used = new Set<string>();
  const out: WeekIdea[] = [];
  for (const p of plan.slice(0, days * 2)) {
    let date = shift(today, Math.max(0, Math.round(p.day)));
    for (let i = 0; i < 14 && off(date); i++) date = shift(date, 1);
    if (off(date) || date > until) continue;
    const ev = (events ?? []).find((e) => e.title && p.title.toLowerCase().includes(String(e.title).toLowerCase()));
    out.push({
      day: p.day,
      date,
      title: p.title,
      idea: p.idea,
      category: p.category,
      category_id: byName.get(p.category.toLowerCase()) ?? null,
      event_id: (ev?.id as string | undefined) ?? null,
      // One new idea per day, and none on a day that already has a post.
      taken: taken.has(date) || used.has(date),
    });
    used.add(date);
  }
  return out;
}
