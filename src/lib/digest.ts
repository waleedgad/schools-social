import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/alerts";
import { digestDue, digestText, type Digest } from "@/lib/digest-format";
import { createAdminClient } from "@/lib/supabase/admin";

export type { Digest };

// The principal's weekly digest: the numbers for the last 7 days. The page
// (/digest) and the Sunday email use this one function, so they always agree.
const DAY = 86400_000;
const dayKey = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

export async function weekDigest(db: SupabaseClient, schoolId: string, timeZone: string, now = new Date()): Promise<Digest> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const until = new Date(now.getTime() + 7 * DAY).toISOString();
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);
  const posts = () => db.from("posts").select("id", { count: "exact", head: true }).eq("school_id", schoolId);
  const [posted, failed, waitingComms, waitingExtra, scheduled, students, coverage] = await Promise.all([
    count(posts().eq("status", "published").gte("published_at", since).lte("published_at", now.toISOString())),
    count(posts().eq("status", "failed").gte("updated_at", since)),
    count(posts().eq("status", "in_review")),
    count(posts().eq("status", "waiting_extra")),
    count(posts().in("status", ["approved", "scheduled"]).gt("scheduled_at", now.toISOString()).lte("scheduled_at", until)),
    db.from("students").select("student_code, class_name").eq("school_id", schoolId).limit(20000),
    db.from("student_coverage").select("student_code, photos").eq("school_id", schoolId).gt("photos", 0).limit(20000),
  ]);
  const seen = new Set((coverage.data ?? []).map((r) => r.student_code as string));
  const list = students.data ?? [];
  const missing = list.filter((s) => !s.student_code || !seen.has(s.student_code as string));
  const byClass = new Map<string, number>();
  for (const s of missing) byClass.set((s.class_name as string | null) ?? "", (byClass.get((s.class_name as string | null) ?? "") ?? 0) + 1);
  return {
    from: dayKey(new Date(now.getTime() - 6 * DAY), timeZone),
    to: dayKey(now, timeZone),
    posted,
    failed,
    waitingComms,
    waitingExtra,
    scheduled,
    students: list.length,
    notSeen: missing.length,
    notSeenByClass: [...byClass].map(([className, n]) => ({ className, count: n })).sort((a, b) => b.count - a.count || a.className.localeCompare(b.className)).slice(0, 8),
  };
}

// Sunday morning: each school that wants it gets its digest email once a
// week (the alert key makes sure of that). Called by the scheduled job.
export async function sendDigests(admin: SupabaseClient = createAdminClient(), now = new Date()) {
  const { data: rows } = await admin.from("school_integrations").select("school_id, alert_kinds, email_alerts, school:schools(name, timezone)").eq("email_alerts", true).contains("alert_kinds", ["digest"]).limit(500);
  let sent = 0;
  for (const r of rows ?? []) {
    const school = r.school as unknown as { name: string; timezone: string | null } | null;
    const tz = school?.timezone || "Africa/Cairo";
    const week = digestDue(now, tz);
    if (!week || !school) continue;
    const key = `digest:${week}`;
    const { data: done } = await admin.from("alert_outbox").select("id").eq("school_id", r.school_id).eq("key", key).maybeSingle();
    if (done) continue;
    const d = await weekDigest(admin, r.school_id as string, tz, now);
    await notify(r.school_id as string, "digest", `ملخص الأسبوع · Weekly digest: ${school.name}`, digestText(d, school.name), "/digest", { key });
    sent++;
  }
  return sent;
}
