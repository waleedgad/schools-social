import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured, sendEmail } from "./alerts";
import { thumbPath } from "./images";

const DAY = 24 * 3600_000;

// A library computer that hasn't been in touch for more than a day (the app
// checks in at start and every 6 hours). One email to the Admin and Comms
// lead each time it goes quiet; none for computers quiet for over 30 days
// (taken out of use). Nothing is sent, and nothing marked, until email
// sending is set up (RESEND_API_KEY): then quiet computers get their email.
export async function sendComputerOffAlerts(admin: SupabaseClient, now = Date.now()) {
  if (!isEmailConfigured()) return 0;
  const { data } = await admin
    .from("computers")
    .select("id, school_id, name, platform, last_seen_at, off_alert_at")
    .lt("last_seen_at", new Date(now - DAY).toISOString())
    .gt("last_seen_at", new Date(now - 30 * DAY).toISOString())
    .limit(200);
  const quiet = ((data ?? []) as { id: string; school_id: string; name: string | null; platform: string | null; last_seen_at: string; off_alert_at: string | null }[]).filter(
    (c) => !c.off_alert_at || Date.parse(c.off_alert_at) < Date.parse(c.last_seen_at),
  );
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
  let sent = 0;
  for (const c of quiet) {
    const { data: school } = await admin.from("schools").select("name, timezone").eq("id", c.school_id).single();
    const { data: state } = await admin.rpc("school_state", { p_school: c.school_id });
    if (!school || state === "blocked") continue;
    // Taken by one run only.
    const claim = admin.from("computers").update({ off_alert_at: new Date(now).toISOString() }).eq("id", c.id).eq("last_seen_at", c.last_seen_at);
    const { data: took } = await (c.off_alert_at ? claim.eq("off_alert_at", c.off_alert_at) : claim.is("off_alert_at", null)).select("id").maybeSingle();
    if (!took) continue;
    const { data: people } = await admin.from("memberships").select("user_id").eq("school_id", c.school_id).eq("active", true).in("role", ["admin", "comms_lead"]);
    const emails = (await Promise.all((people ?? []).map(async (p) => (await admin.auth.admin.getUserById(p.user_id as string)).data.user?.email ?? null))).filter((e): e is string => !!e);
    if (!emails.length) continue;
    const kind = c.platform === "win32" ? "Windows PC" : "Mac";
    const kindAr = c.platform === "win32" ? "جهاز ويندوز" : "جهاز ماك";
    const name = c.name?.trim() || kind;
    const tz = (school.timezone as string) || "Africa/Cairo";
    const when = (l: string) => new Date(c.last_seen_at).toLocaleString(l, { dateStyle: "medium", timeStyle: "short", timeZone: tz });
    const subject = `${school.name}: library ${kind} "${name}" has been off for over a day · ${kindAr} المكتبة متوقف منذ أكثر من يوم`;
    const body =
      `The library ${kind} "${name}" was last in touch on ${when("en-GB")}. While it is off, new photos are not sent, uploads from phones and photographers wait for their face check, and posts can't use new photos. Please turn it on and open School Social Hub.\n\n` +
      `آخر اتصال لـ${kindAr} المكتبة "${name}" كان في ${when("ar-EG")}. أثناء توقفه لا تُرسل الصور الجديدة، وتنتظر صور الهواتف والمصورين فحص الوجوه، ولا يمكن استخدام صور جديدة في المنشورات. يُرجى تشغيله وفتح البرنامج.`;
    if (await sendEmail(emails, subject, `${body}${site ? `\n\n${site}/settings?tab=computers` : ""}`).catch(() => false)) sent++;
  }
  return sent;
}

// The website's storage clean-up: web copies older than 6 months that were
// never used (old_web_copies() in 0020 says which). Only the small website
// copy goes; the original stays on the school's drive, and the Mac sends the
// photo again if it is ever put in a post. Runs once a day, in small batches.
export async function cleanOldWebCopies(admin: SupabaseClient, now = new Date()) {
  if (now.getUTCHours() !== 1) return 0;
  const { data, error } = await admin.rpc("old_web_copies", { p_limit: 200 });
  if (error || !data?.length) return 0;
  const rows = data as { id: string; school_id: string; storage_path: string; edited_path: string | null }[];
  const { data: gone, error: delError } = await admin.from("photos").delete().in("id", rows.map((r) => r.id)).select("id");
  if (delError) return 0;
  const removed = new Set((gone ?? []).map((g) => g.id as string));
  const files = rows.filter((r) => removed.has(r.id)).flatMap((r) => [r.storage_path, r.edited_path].filter((f): f is string => !!f).flatMap((f) => [f, thumbPath(f)]));
  for (let i = 0; i < files.length; i += 500) await admin.storage.from("photos").remove(files.slice(i, i + 500));
  const perSchool = new Map<string, number>();
  for (const r of rows) if (removed.has(r.id)) perSchool.set(r.school_id, (perSchool.get(r.school_id) ?? 0) + 1);
  if (perSchool.size) await admin.from("audit_log").insert([...perSchool].map(([school_id, count]) => ({ school_id, user_id: null, action: "photos.cleaned", target: null, details: { count } })));
  return removed.size;
}
