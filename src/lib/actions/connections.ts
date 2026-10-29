"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { notify } from "@/lib/alerts";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Holiday cover, stages for a head of stage, and the school's connections
// (Slack, Teams, email alerts, WhatsApp photo intake).

async function admin(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) => supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action, target, details });
  return { locale, user, membership, supabase, schoolId, audit };
}
const back = (locale: string, tab: string, query: Record<string, string> = {}) => redirect({ href: { pathname: "/settings", query: { tab, ...query } }, locale });
const isDay = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Someone else approves for set dates (a principal on holiday, the comms
// lead off sick). An admin can set it for anyone; others for themselves.
export async function addCover(formData: FormData) {
  const { locale, user, membership, supabase, schoolId, audit } = await admin(formData);
  const isAdmin = membership.role === "admin";
  const from = isAdmin ? String(formData.get("from") ?? user.id) : user.id;
  const to = String(formData.get("to") ?? "");
  const starts = formData.get("starts");
  const ends = formData.get("ends");
  if (!to || to === from || !isDay(starts) || !isDay(ends) || String(ends) < String(starts)) back(locale, "approvals", { error: "cover" });
  const { error } = await supabase.from("approval_cover").insert({ school_id: schoolId, from_user: from, to_user: to, starts_on: starts, ends_on: ends });
  if (error) back(locale, "approvals", { error: "cover" });
  await audit("cover.added", to, { from, starts, ends });
  back(locale, "approvals", { saved: "1" });
}

export async function removeCover(formData: FormData) {
  const { locale, supabase, audit } = await admin(formData);
  const id = String(formData.get("id") ?? "");
  await supabase.from("approval_cover").delete().eq("id", id);
  await audit("cover.removed", id);
  back(locale, "approvals", { saved: "1" });
}

// A head of stage only sees posts about classes in their stages.
export async function saveStages(formData: FormData) {
  const { locale, membership, supabase, schoolId, audit } = await admin(formData);
  if (!can(membership.role, "manageStaff", membership.school.permissions)) back(locale, "approvals");
  const userId = String(formData.get("userId") ?? "");
  const stages = formData.getAll("stage").map(String).filter(Boolean).slice(0, 10);
  await supabase.from("memberships").update({ stages }).eq("school_id", schoolId).eq("user_id", userId);
  await audit("member.stages", userId, { stages });
  back(locale, "approvals", { saved: "1" });
}

export async function saveConnections(formData: FormData) {
  const { locale, membership, supabase, schoolId, audit } = await admin(formData);
  if (!can(membership.role, "manageSettings", membership.school.permissions)) back(locale, "connections");
  const slack = String(formData.get("slack") ?? "").trim();
  const teams = String(formData.get("teams") ?? "").trim();
  const phoneId = String(formData.get("whatsappPhoneId") ?? "").trim();
  const event = String(formData.get("whatsappEvent") ?? "");
  if ((slack && !slack.startsWith("https://hooks.slack.com/")) || (teams && !teams.startsWith("https://"))) back(locale, "connections", { error: "webhook" });
  const { error } = await supabase.from("school_integrations").upsert({
    school_id: schoolId,
    slack_webhook: slack || null,
    teams_webhook: teams || null,
    email_alerts: formData.get("email") === "on",
    alert_kinds: formData.getAll("kind").map(String).filter((k) => ["approval", "failed", "import", "comment", "remind", "book"].includes(k)),
    whatsapp_phone_id: /^\d{5,40}$/.test(phoneId) ? phoneId : null,
    whatsapp_event: /^[0-9a-f-]{36}$/.test(event) ? event : null,
    updated_at: new Date().toISOString(),
  });
  if (error) back(locale, "connections", { error: "save" });
  await audit("settings.connections", schoolId, { slack: !!slack, teams: !!teams });
  revalidatePath(`/${locale}/settings`);
  back(locale, "connections", { saved: "1" });
}

export async function testAlert(formData: FormData) {
  const { locale, membership, schoolId } = await admin(formData);
  if (!can(membership.role, "manageSettings", membership.school.permissions)) back(locale, "connections");
  await notify(schoolId, "approval", "Test alert · تنبيه تجريبي", `${membership.fullName}: this is how alerts from School Social Hub look.`, "/today");
  back(locale, "connections", { tested: "1" });
}
