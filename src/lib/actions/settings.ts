"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { stateWithServiceKey } from "@/lib/plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkToken, MetaError } from "@/lib/meta";

async function admin(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, "manageSettings", membership.school.permissions)) redirect({ href: "/today", locale });
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const audit = (action: string, target: string) =>
    supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action, target });
  return { locale, schoolId, supabase, audit };
}

export async function saveSettings(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await admin(formData);
  const languages = String(formData.get("captionLanguages") ?? "ar_en");
  const timezone = String(formData.get("timezone") ?? "Africa/Cairo");
  const { error } = await supabase
    .from("schools")
    .update({
      name: String(formData.get("name") ?? "").trim().slice(0, 120),
      default_locale: formData.get("defaultLocale") === "en" ? "en" : "ar",
      timezone: Intl.supportedValuesOf("timeZone").includes(timezone) ? timezone : "Africa/Cairo",
      brand_voice: String(formData.get("brandVoice") ?? "").trim().slice(0, 500) || null,
      hashtags: String(formData.get("hashtags") ?? "").trim().slice(0, 300) || null,
      caption_languages: ["ar", "en", "ar_en"].includes(languages) ? languages : "ar_en",
    })
    .eq("id", schoolId);
  if (error) redirect({ href: { pathname: "/settings", query: { error: "save" } }, locale });
  await audit("settings.saved", schoolId);
  revalidatePath(`/${locale}`, "layout");
  redirect({ href: { pathname: "/settings", query: { saved: "1" } }, locale });
}

type StoredPage = { id: string; name: string; token: string; ig_user_id: string | null; ig_username: string | null };

export async function choosePage(formData: FormData) {
  const { locale, schoolId, audit } = await admin(formData);
  const pageId = String(formData.get("page") ?? "");
  const db = createAdminClient();
  if ((await stateWithServiceKey(db, schoolId)) !== "active") redirect({ href: { pathname: "/settings", query: { error: "readOnly", tab: "connections" } }, locale });
  const { data } = await db.from("meta_connections").select("pages").eq("school_id", schoolId).maybeSingle();
  const page = ((data?.pages ?? []) as StoredPage[]).find((p) => p.id === pageId);
  if (page) {
    await db
      .from("meta_connections")
      .update({ page_id: page.id, page_name: page.name, page_token: page.token, ig_user_id: page.ig_user_id, ig_username: page.ig_username, last_error: null, needs_reconnect: false, reconnect_since: null, permissions: null, checked_at: null })
      .eq("school_id", schoolId);
    await audit("meta.page_chosen", page.name);
  }
  redirect({ href: "/accounts", locale });
}

export async function disconnectMeta(formData: FormData) {
  const { locale, schoolId, audit } = await admin(formData);
  if ((await stateWithServiceKey(createAdminClient(), schoolId)) !== "active") redirect({ href: { pathname: "/settings", query: { error: "readOnly", tab: "connections" } }, locale });
  await createAdminClient().from("meta_connections").delete().eq("school_id", schoolId);
  await audit("meta.disconnected", schoolId);
  redirect({ href: "/accounts", locale });
}

// Check connection (release 0.17): asks Meta what the school's key may still
// do and saves it for the Accounts page. A key that no longer works is
// marked "Reconnect" right away, before any post fails on it.
export async function checkConnection(formData: FormData) {
  const { locale, schoolId, audit } = await admin(formData);
  const db = createAdminClient();
  const { data: meta } = await db.from("meta_connections").select("page_token").eq("school_id", schoolId).maybeSingle();
  if (!meta?.page_token) redirect({ href: "/accounts", locale });
  let result = "checked";
  try {
    const r = await checkToken(meta!.page_token as string);
    await db
      .from("meta_connections")
      .update({
        permissions: r.scopes.slice(0, 60),
        checked_at: new Date().toISOString(),
        token_expires_at: r.expiresAt,
        ...(r.valid ? { needs_reconnect: false, reconnect_since: null, last_error: null } : { needs_reconnect: true, reconnect_since: new Date().toISOString() }),
      })
      .eq("school_id", schoolId);
    if (!r.valid) result = "signedOut";
  } catch (e) {
    // Meta refused the question itself (for example a wrong app key in
    // Vercel): say so, but don't stop the school's posts over it.
    result = "checkFailed";
    console.error("check connection", e instanceof MetaError ? e.message : String(e).slice(0, 200));
  }
  await audit("meta.checked", result);
  redirect({ href: { pathname: "/accounts", query: { check: result } }, locale });
}
