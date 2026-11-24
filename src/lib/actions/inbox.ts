"use server";

import { isActive } from "@/lib/plan";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { AiLimitError, getAi, type SchoolProfile } from "@/lib/ai";
import { schoolAvoid } from "@/lib/caption-learning";
import { hideComment, isGraphId, replyToComment, sendPageMessage } from "@/lib/meta";
import { isComms } from "@/lib/roles";
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
  return (await pageInfo(schoolId))?.token ?? null;
}
async function pageInfo(schoolId: string) {
  if (!isAdminConfigured) return null;
  const { data } = await createAdminClient().from("meta_connections").select("page_token, page_id").eq("school_id", schoolId).maybeSingle();
  return data?.page_token ? { token: data.page_token as string, pageId: (data.page_id as string | null) ?? "" } : null;
}

export async function suggestReplies(locale: string, comment: string, postText: string) {
  const { membership } = await inboxUser(locale);
  const supabase = await createClient();
  if (!(await isActive(supabase, membership.school.id))) return { error: "readOnly" };
  const { data: school } = await supabase.from("schools").select("profile").eq("id", membership.school.id).single();
  const profile = (school?.profile ?? {}) as SchoolProfile;
  try {
    return { replies: await getAi().suggestReplies(comment, postText, profile, await schoolAvoid(supabase, membership.school.id, profile)) };
  } catch (e) {
    return { error: e instanceof AiLimitError ? "limit" : "error" };
  }
}

export async function sendReply(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await inboxUser(locale);
  const platform = formData.get("platform") === "instagram" ? "instagram" : "facebook";
  // A comment reply, or a private message back to the person (kind=message,
  // with the person's Meta id in "comment").
  const isMessage = formData.get("kind") === "message";
  const commentId = String(formData.get("comment") ?? "");
  const message = String(formData.get("message") ?? "").trim().slice(0, 1000);
  const page = (await isActive(await createClient(), membership.school.id)) ? await pageInfo(membership.school.id) : null;
  let ok = false;
  if (page && message && (!isMessage || isGraphId(commentId))) {
    ok = isMessage
      ? !!(await sendPageMessage(page.pageId, commentId, page.token, message).catch(() => null))
      : !!(await replyToComment(platform, commentId, page.token, message).catch(() => null));
    const supabase = await createClient();
    await supabase.from("audit_log").insert({ school_id: membership.school.id, user_id: user.id, action: isMessage ? (ok ? "inbox.messaged" : "inbox.message_failed") : ok ? "inbox.replied" : "inbox.reply_failed", target: commentId, details: { platform } });
  }
  revalidatePath(`/${locale}/inbox`);
  redirect({ href: { pathname: "/inbox", query: { sent: ok ? "1" : "0", ...(isMessage ? { view: "messages" } : {}) } }, locale });
}

// Saved replies: short answers the team uses again and again (fees, dates,
// "please send us a private message"), in Arabic or English.
export async function addSavedReply(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { membership } = await inboxUser(locale);
  if (!isComms(membership.role)) return;
  const title = String(formData.get("title") ?? "").trim().slice(0, 60);
  const body = String(formData.get("body") ?? "").trim().slice(0, 1000);
  if (title && body) await (await createClient()).from("snippets").insert({ school_id: membership.school.id, kind: "reply", title, body });
  revalidatePath(`/${locale}/inbox`);
}

export async function removeSavedReply(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { membership } = await inboxUser(locale);
  if (!isComms(membership.role)) return;
  await (await createClient()).from("snippets").delete().eq("id", String(formData.get("reply") ?? "")).eq("school_id", membership.school.id).eq("kind", "reply");
  revalidatePath(`/${locale}/inbox`);
}

export async function toggleHidden(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { membership } = await inboxUser(locale);
  const platform = formData.get("platform") === "instagram" ? "instagram" : "facebook";
  const token = await pageToken(membership.school.id);
  if (token) await hideComment(platform, String(formData.get("comment") ?? ""), token, formData.get("hide") === "1").catch(() => null);
  redirect({ href: "/inbox", locale });
}
