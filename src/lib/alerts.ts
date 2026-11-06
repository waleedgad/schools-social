import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { can, type Permission, type PermissionOverrides, type Role } from "@/lib/roles";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// Alerts outside the app: email (through Resend, free for small schools),
// and a school's own Slack or Microsoft Teams channel (an incoming webhook
// the admin pastes in Settings). Nothing here ever blocks the work that
// triggered it: failures are logged and dropped.

export type AlertKind = "approval" | "failed" | "import" | "comment" | "remind" | "book" | "digest";

const resendKey = () => (process.env.RESEND_API_KEY ?? "").trim();
const fromAddress = () => (process.env.ALERT_FROM ?? "").trim() || "School Social Hub <onboarding@resend.dev>";
const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
export const isEmailConfigured = () => resendKey().length > 0;

export async function sendEmail(to: string[], subject: string, text: string) {
  if (!isEmailConfigured() || !to.length) return false;
  const res = await fetch(`${(process.env.RESEND_URL ?? "").trim() || "https://api.resend.com"}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey()}`, "content-type": "application/json" },
    body: JSON.stringify({ from: fromAddress(), to: to.slice(0, 50), subject: subject.slice(0, 200), text }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return !!res?.ok;
}

async function webhook(url: string, kind: "slack" | "teams", title: string, text: string, link: string | null) {
  const body =
    kind === "slack"
      ? { text: `*${title}*\n${text}${link ? `\n<${link}|Open>` : ""}` }
      : {
          type: "message",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: {
                type: "AdaptiveCard",
                version: "1.4",
                body: [
                  { type: "TextBlock", text: title, weight: "Bolder", wrap: true },
                  { type: "TextBlock", text, wrap: true },
                ],
                actions: link ? [{ type: "Action.OpenUrl", title: "Open", url: link }] : [],
              },
            },
          ],
        };
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }).catch(() => null);
}

// Who gets email for each kind that isn't about one post waiting for a step.
const ROLES_FOR: Record<AlertKind, Role[]> = {
  approval: ["admin", "comms_lead", "principal"],
  failed: ["admin", "comms_lead"],
  import: ["admin", "comms_lead", "comms"],
  comment: ["admin", "comms_lead", "comms"],
  remind: ["admin", "comms_lead", "principal"],
  book: ["admin", "comms_lead", "comms", "teacher"],
  digest: ["admin", "principal"],
};

export type AlertOptions = {
  // The post the alert is about: "waiting for you" alerts then go only to the
  // people who can take the step the post is waiting for.
  postId?: string;
  // The person whose action made the alert never gets it.
  actorId?: string;
  // The same key is only ever sent once.
  key?: string;
  // Sent even in quiet hours (the admin's "send a test alert" button).
  now?: boolean;
};

type Member = { user_id: string; role: Role; stages: string[] | null };

// The people who can take the step a post is waiting for, by the same rules
// the database uses (guard_post: is_comms_approver / is_extra_approver), the
// school's own ticks per role, and a head of stage only for their stages.
async function whoActs(admin: SupabaseClient, schoolId: string, members: Member[], postId: string): Promise<string[]> {
  const [{ data: post }, { data: school }, { data: cover }] = await Promise.all([
    admin.from("posts").select("status, created_by, event:events(class_name)").eq("id", postId).eq("school_id", schoolId).maybeSingle(),
    admin.from("schools").select("approve_by, extra_approvers, permissions, timezone").eq("id", schoolId).single(),
    admin.from("approval_cover").select("from_user, to_user, starts_on, ends_on").eq("school_id", schoolId),
  ]);
  if (!post || !school) return [];
  const perms = (school.permissions ?? null) as PermissionOverrides | null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: (school.timezone as string) || "Africa/Cairo" }).format(new Date());
  const roleOf = new Map(members.map((m) => [m.user_id, m.role]));
  const covering = (from: (id: string) => boolean) =>
    (cover ?? []).filter((c) => c.starts_on <= today && c.ends_on >= today && from(c.from_user as string)).map((c) => c.to_user as string);
  const author = post.created_by as string | null;
  let ids: string[] = [];
  let permission: Permission;
  if (post.status === "in_review") {
    permission = "approvePosts";
    const lead = (id: string) => ["admin", "comms_lead"].includes(roleOf.get(id) ?? "");
    ids = members.filter((m) => lead(m.user_id) || (school.approve_by === "any_other" && m.role === "comms")).map((m) => m.user_id);
    ids.push(...covering(lead));
  } else if (post.status === "waiting_extra") {
    permission = "extraApprove";
    const chosen = (school.extra_approvers ?? []) as string[];
    const extra = (id: string) => (chosen.length ? chosen.includes(id) : ["admin", "principal"].includes(roleOf.get(id) ?? ""));
    ids = members.filter((m) => extra(m.user_id)).map((m) => m.user_id);
    ids.push(...covering((id) => chosen.includes(id) || ["admin", "principal"].includes(roleOf.get(id) ?? "")));
  } else return [];
  // Only active members, with the right for this step in this school.
  ids = [...new Set(ids)].filter((id) => roleOf.has(id) && can(roleOf.get(id)!, permission, perms));
  // Nobody approves their own post for the comms step.
  if (post.status === "in_review") ids = ids.filter((id) => id !== author);
  // A head of stage only for posts about their stages (or the whole school).
  const className = (post.event as { class_name?: string | null } | null)?.class_name ?? null;
  const limited = members.filter((m) => ids.includes(m.user_id) && m.role === "principal" && (m.stages ?? []).length);
  if (className && limited.length) {
    const { data: rows } = await admin.from("students").select("stage").eq("school_id", schoolId).eq("class_name", className).limit(50);
    const stages = new Set((rows ?? []).map((r) => r.stage as string));
    const out = new Set(limited.filter((m) => !(m.stages ?? []).some((s) => stages.has(s))).map((m) => m.user_id));
    ids = ids.filter((id) => !out.has(id));
  }
  return ids;
}

// Quiet hours, in the school's own time zone: when they end (or null when
// it isn't quiet now).
export function quietUntil(at: Date, timeZone: string, from: string | null, to: string | null): Date | null {
  if (!from || !to) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).split(":").map(Number);
  const now = h * 60 + m, f = mins(from), t = mins(to);
  if (f === t) return null;
  const quiet = f < t ? now >= f && now < t : now >= f || now < t;
  if (!quiet) return null;
  return new Date(at.getTime() + (((t - now + 1440) % 1440) * 60 - at.getUTCSeconds()) * 1000);
}

async function deliver(admin: SupabaseClient, row: { school_id: string; title: string; body: string; link: string | null; emails: string[] }) {
  const { data: cfg } = await admin.from("school_integrations").select("slack_webhook, teams_webhook").eq("school_id", row.school_id).maybeSingle();
  const jobs: Promise<unknown>[] = [];
  if (cfg?.slack_webhook) jobs.push(webhook(cfg.slack_webhook as string, "slack", row.title, row.body, row.link));
  if (cfg?.teams_webhook) jobs.push(webhook(cfg.teams_webhook as string, "teams", row.title, row.body, row.link));
  if (row.emails.length) jobs.push(sendEmail(row.emails, row.title, `${row.body}${row.link ? `\n\n${row.link}` : ""}`));
  await Promise.all(jobs);
}

export async function notify(schoolId: string, kind: AlertKind, title: string, text: string, path: string | null = null, opts: AlertOptions = {}) {
  if (!isAdminConfigured) return;
  try {
    const admin = createAdminClient();
    const { data: cfg } = await admin.from("school_integrations").select("slack_webhook, teams_webhook, email_alerts, alert_kinds, quiet_from, quiet_to").eq("school_id", schoolId).maybeSingle();
    if (!cfg || !(cfg.alert_kinds as string[]).includes(kind)) return;
    if (!cfg.slack_webhook && !cfg.teams_webhook && !(cfg.email_alerts && isEmailConfigured())) return;
    const link = path && site() ? `${site()}${path}` : null;
    let emails: string[] = [];
    if (cfg.email_alerts && isEmailConfigured()) {
      const { data: people } = await admin.from("memberships").select("user_id, role, stages").eq("school_id", schoolId).eq("active", true);
      const members = (people ?? []) as Member[];
      let ids = opts.postId && (kind === "approval" || kind === "remind") ? await whoActs(admin, schoolId, members, opts.postId) : members.filter((m) => ROLES_FOR[kind].includes(m.role)).map((m) => m.user_id);
      ids = [...new Set(ids)].filter((id) => id !== opts.actorId).slice(0, 30);
      emails = [...new Set((await Promise.all(ids.map(async (id) => (await admin.auth.admin.getUserById(id)).data.user?.email ?? null))).filter((e): e is string => !!e))];
    }
    // Nobody can act on it, and no team channel: nothing to send.
    if (!emails.length && !cfg.slack_webhook && !cfg.teams_webhook) return;
    const { data: school } = await admin.from("schools").select("timezone").eq("id", schoolId).single();
    const wait = opts.now ? null : quietUntil(new Date(), (school?.timezone as string) || "Africa/Cairo", cfg.quiet_from as string | null, cfg.quiet_to as string | null);
    const { data: row, error } = await admin
      .from("alert_outbox")
      .insert({ school_id: schoolId, kind, key: opts.key ?? null, title: title.slice(0, 200), body: text.slice(0, 2000), link, emails, send_after: (wait ?? new Date()).toISOString(), sent_at: wait ? null : new Date().toISOString() })
      .select("id")
      .single();
    // The same key again: already sent (or waiting), never twice.
    if (error?.code === "23505" || (row && wait)) return;
    await deliver(admin, { school_id: schoolId, title, body: text, link, emails });
  } catch (e) {
    console.error("alert failed", kind, String(e).slice(0, 200));
  }
}

// Alerts kept back during quiet hours go out once they end. Called by the
// scheduled job every few minutes; each alert is taken by one call only.
export async function flushAlerts(admin: SupabaseClient) {
  const { data: due } = await admin.from("alert_outbox").select("id").is("sent_at", null).lte("send_after", new Date().toISOString()).order("send_after").limit(50);
  let sent = 0;
  for (const { id } of due ?? []) {
    const { data: row } = await admin.from("alert_outbox").update({ sent_at: new Date().toISOString() }).eq("id", id).is("sent_at", null).select("school_id, title, body, link, emails").maybeSingle();
    if (!row) continue;
    await deliver(admin, row as { school_id: string; title: string; body: string; link: string | null; emails: string[] }).catch(() => null);
    sent++;
  }
  return sent;
}
