"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { thumbPath } from "@/lib/images";
import type { EditSettings } from "@/lib/photo-edit";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

async function curator(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, "manageEvents")) redirect({ href: "/dashboard", locale });
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) =>
    supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action, target, details });
  return { locale, user, schoolId, supabase, audit };
}

export async function createEvent(formData: FormData) {
  const { locale, user, schoolId, supabase, audit } = await curator(formData);
  const title = String(formData.get("title") ?? "").trim();
  const className = String(formData.get("className") ?? "").trim() || null;
  const eventDate = String(formData.get("eventDate") ?? "") || new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("events")
    .insert({ school_id: schoolId, title, class_name: className, event_date: eventDate, created_by: user.id })
    .select("id")
    .single();
  if (error) redirect({ href: { pathname: "/library", query: { error: "event" } }, locale });

  await audit("event.created", title);
  redirect({ href: { pathname: "/library", query: { event: data!.id } }, locale });
}

export async function setOptedOut(formData: FormData) {
  const { locale, supabase, audit } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  const value = formData.get("value") === "true";

  await supabase.from("photos").update({ contains_opted_out: value }).eq("id", id);
  await audit(value ? "photo.flagged" : "photo.unflagged", id);
  revalidatePath(`/${locale}/library`);
}

export async function deletePhoto(formData: FormData) {
  const { locale, supabase, audit } = await curator(formData);
  const id = String(formData.get("id") ?? "");

  const { data } = await supabase
    .from("photos")
    .delete()
    .eq("id", id)
    .select("storage_path, edited_path")
    .maybeSingle();
  if (data) {
    const files = [data.storage_path, data.edited_path].filter(Boolean) as string[];
    await supabase.storage.from("photos").remove(files.flatMap((f) => [f, thumbPath(f)]));
    await audit("photo.deleted", id);
  }
  revalidatePath(`/${locale}/library`);
}

async function replaceEdit(locale: string, photoId: string, path: string | null, settings: EditSettings | null) {
  const fd = new FormData();
  fd.set("locale", locale);
  const { schoolId, supabase, audit } = await curator(fd);
  if (path && !path.startsWith(`${schoolId}/${photoId}_e`)) return;

  const { data: before } = await supabase.from("photos").select("edited_path").eq("id", photoId).maybeSingle();
  const { error } = await supabase
    .from("photos")
    .update({ edited_path: path, edit_settings: settings })
    .eq("id", photoId);
  if (error) throw error;
  if (before?.edited_path) {
    await supabase.storage.from("photos").remove([before.edited_path, thumbPath(before.edited_path)]);
  }
  await audit(path ? "photo.edited" : "photo.edit_cleared", photoId);
  revalidatePath(`/${locale}/library`);
}

export async function saveEdit(locale: string, photoId: string, path: string, settings: EditSettings) {
  await replaceEdit(locale, photoId, path, settings);
}

export async function clearEdit(locale: string, photoId: string) {
  await replaceEdit(locale, photoId, null, null);
}
