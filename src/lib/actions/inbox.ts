"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { AiLimitError, getAi, type SchoolProfile } from "@/lib/ai";
import { hideComment, replyToComment } from "@/lib/meta";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function inboxUser(locale: string) {
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, "writePosts", membership.school.permissions)) redirect({ href: "/today", locale });
  return { user, membership };
}

// The page token is secret, so replies go through the server key after the
// role check.
async function pageToken(schoolId: string) {
  if (!isAdminConfigured) return null;
  const { data } = await createAdminClient().from("meta_connections").select("page_token").eq("school_id", schoolId).maybeSingle();
  return (data?.page_token as string | undefined) ?? null;
}

export async function suggestReplies(locale: string, comment: string, postText: string) {
  const { membership } = await inboxUser(locale);
  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("profile").eq("id", membership.school.id).single();
  try {
    return { replies: await getAi().suggestReplies(comment, postText, (school?.profile ?? {}) as SchoolProfile) };
  } catch (e) {
    return { error: e instanceof AiLimitError ? "limit" : "error" };
  }
}

export async function sendReply(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await inboxUser(locale);
  const platform = formData.get("platform") === "instagram" ? "instagram" : "facebook";
  const commentId = String(formData.get("comment") ?? "");
  const message = String(formData.get("message") ?? "").trim().slice(0, 1000);
  const token = await pageToken(membership.school.id);
  let ok = false;
  if (token && message) {
    ok = !!(await replyToComment(platform, commentId, token, message).catch(() => null));
    const supabase = await createClient();
    await supabase.from("audit_log").insert({ school_id: membership.school.id, user_id: user.id, action: ok ? "inbox.replied" : "inbox.reply_failed", target: commentId, details: { platform } });
  }
  revalidatePath(`/${locale}/inbox`);
  redirect({ href: { pathname: "/inbox", query: { sent: ok ? "1" : "0" } }, locale });
}

export async function toggleHidden(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { membership } = await inboxUser(locale);
  const platform = formData.get("platform") === "instagram" ? "instagram" : "facebook";
  const token = await pageToken(membership.school.id);
  if (token) await hideComment(platform, String(formData.get("comment") ?? ""), token, formData.get("hide") === "1").catch(() => null);
  redirect({ href: "/inbox", locale });
}
