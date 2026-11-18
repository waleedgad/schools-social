import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured, sendEmail } from "./alerts";

// Plan warnings (0.13): 14, 7 and 1 days before "paid until", then every
// read-only day. The database writes the in-app alert for the Admin and
// Comms lead once each (plan_warnings, 0019) and returns only the new ones,
// which also go out by email once email sending is set up. Never to the
// team's Slack or Teams channel: only the two people who can renew.
export async function sendPlanWarnings(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("plan_warnings");
  if (error) return 0;
  const rows = (data ?? []) as { school_id: string; state: string; days: number; paid_until: string }[];
  if (!rows.length || !isEmailConfigured()) return rows.length;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  for (const r of rows) {
    const { data: people } = await admin.from("memberships").select("user_id").eq("school_id", r.school_id).eq("active", true).in("role", ["admin", "comms_lead"]);
    const emails = (await Promise.all((people ?? []).map(async (p) => (await admin.auth.admin.getUserById(p.user_id as string)).data.user?.email ?? null))).filter((e): e is string => !!e);
    if (!emails.length) continue;
    const { data: school } = await admin.from("schools").select("name").eq("id", r.school_id).single();
    const name = (school?.name as string | undefined) ?? "";
    const subject =
      r.state === "read_only"
        ? `${name}: read-only, ${r.days} days before access is paused · للقراءة فقط، ${r.days} يوم قبل إيقاف الدخول`
        : `${name}: your plan ends in ${r.days} days · تنتهي الباقة خلال ${r.days} يوم`;
    const body =
      r.state === "read_only"
        ? `Your school is in read-only mode. Posting is paused and nothing can be changed. Access pauses in ${r.days} days unless the plan is renewed.\n\nمدرستكم في وضع القراءة فقط. النشر متوقف ولا يمكن تغيير أي شيء. يتوقف الدخول خلال ${r.days} يوم ما لم تُجدَّد الباقة.`
        : `Your school's plan is paid until ${r.paid_until}. Contact us to renew.\n\nباقة مدرستكم مدفوعة حتى ${r.paid_until}. تواصلوا معنا للتجديد.`;
    await sendEmail(emails, subject, `${body}${site ? `\n\n${site}/plan` : ""}`).catch(() => null);
  }
  return rows.length;
}
