import "server-only";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// Alerts outside the app: email (through Resend, free for small schools),
// and a school's own Slack or Microsoft Teams channel (an incoming webhook
// the admin pastes in Settings). Nothing here ever blocks the work that
// triggered it: failures are logged and dropped.

export type AlertKind = "approval" | "failed" | "import" | "comment" | "remind" | "book";

const resendKey = () => (process.env.RESEND_API_KEY ?? "").trim();
const fromAddress = () => (process.env.ALERT_FROM ?? "").trim() || "School Social Hub <onboarding@resend.dev>";
const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
export const isEmailConfigured = () => resendKey().length > 0;

export async function sendEmail(to: string[], subject: string, text: string) {
  if (!isEmailConfigured() || !to.length) return false;
  const res = await fetch("https://api.resend.com/emails", {
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

// Who gets email for each kind: the people who act on it.
const ROLES_FOR: Record<AlertKind, string[]> = {
  approval: ["admin", "comms_lead", "principal"],
  failed: ["admin", "comms_lead"],
  import: ["admin", "comms_lead", "comms"],
  comment: ["admin", "comms_lead", "comms"],
  remind: ["admin", "comms_lead", "principal"],
  book: ["admin", "comms_lead", "comms", "teacher"],
};

export async function notify(schoolId: string, kind: AlertKind, title: string, text: string, path: string | null = null) {
  if (!isAdminConfigured) return;
  try {
    const admin = createAdminClient();
    const { data: cfg } = await admin.from("school_integrations").select("slack_webhook, teams_webhook, email_alerts, alert_kinds").eq("school_id", schoolId).maybeSingle();
    if (!cfg || !(cfg.alert_kinds as string[]).includes(kind)) return;
    const link = path && site() ? `${site()}${path}` : null;
    const jobs: Promise<unknown>[] = [];
    if (cfg.slack_webhook) jobs.push(webhook(cfg.slack_webhook as string, "slack", title, text, link));
    if (cfg.teams_webhook) jobs.push(webhook(cfg.teams_webhook as string, "teams", title, text, link));
    if (cfg.email_alerts && isEmailConfigured()) {
      const { data: people } = await admin.from("memberships").select("user_id").eq("school_id", schoolId).eq("active", true).in("role", ROLES_FOR[kind]);
      const emails = (
        await Promise.all((people ?? []).slice(0, 30).map(async (p) => (await admin.auth.admin.getUserById(p.user_id as string)).data.user?.email ?? null))
      ).filter((e): e is string => !!e);
      jobs.push(sendEmail(emails, title, `${text}${link ? `\n\n${link}` : ""}`));
    }
    await Promise.all(jobs);
  } catch (e) {
    console.error("alert failed", kind, String(e).slice(0, 200));
  }
}
