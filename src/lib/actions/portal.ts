"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function curator(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, "manageEvents")) redirect({ href: "/dashboard", locale });
  const supabase = await createClient();
  return { locale, user, schoolId: membership.school.id, supabase };
}

export async function createUploadLink(formData: FormData) {
  const { locale, user, schoolId, supabase } = await curator(formData);
  const event = String(formData.get("event") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const { error } = await supabase
    .from("upload_links")
    .insert({ school_id: schoolId, event_id: event, label, created_by: user.id });
  if (!error) {
    await supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action: "portal.link_created", target: label });
  }
  revalidatePath(`/${locale}/library`);
}

export async function revokeUploadLink(formData: FormData) {
  const { locale, user, schoolId, supabase } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  await supabase.from("upload_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  await supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action: "portal.link_revoked", target: id });
  revalidatePath(`/${locale}/library`);
}

// The portal has no signed-in user, so these run with the server key and
// check the link themselves on every call.

const MAX_FILES = 30;

async function usableLink(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("upload_links")
    .select("id, school_id, event_id, label, expires_at, revoked_at, upload_count")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date()) return null;
  return { admin, link: data };
}

export type PortalSlot = { id: string; path: string; thumb: string; token: string; thumbToken: string };

export async function portalSlots(token: string, count: number): Promise<PortalSlot[] | null> {
  const found = await usableLink(token);
  if (!found) return null;
  const { admin, link } = found;
  const bucket = admin.storage.from("photos");

  return Promise.all(
    Array.from({ length: Math.min(MAX_FILES, Math.max(0, count)) }, async () => {
      const id = crypto.randomUUID();
      const path = `${link.school_id}/${id}.jpg`;
      const thumb = `${link.school_id}/${id}_t.jpg`;
      const [a, b] = await Promise.all([bucket.createSignedUploadUrl(path), bucket.createSignedUploadUrl(thumb)]);
      if (a.error || b.error) throw new Error("upload slot failed");
      return { id, path, thumb, token: a.data.token, thumbToken: b.data.token };
    }),
  );
}

export type PortalPhoto = { id: string; width: number; height: number; size: number; name: string };

export async function portalFinish(token: string, photo: PortalPhoto, note: string) {
  const found = await usableLink(token);
  if (!found) return false;
  const { admin, link } = found;
  if (!/^[0-9a-f-]{36}$/.test(photo.id)) return false;

  const path = `${link.school_id}/${photo.id}.jpg`;
  const { data: exists } = await admin.storage.from("photos").exists(path);
  if (!exists) return false;

  const { error } = await admin.from("photos").insert({
    id: photo.id,
    school_id: link.school_id,
    event_id: link.event_id,
    source: "photographer",
    storage_path: path,
    width: Math.round(photo.width) || null,
    height: Math.round(photo.height) || null,
    size_bytes: Math.round(photo.size) || null,
    original_name: String(photo.name).slice(0, 260),
    note: [link.label, note.trim()].filter(Boolean).join(" · ").slice(0, 280),
  });
  if (error) return false;
  await admin.from("upload_links").update({ upload_count: link.upload_count + 1 }).eq("id", link.id);
  return true;
}
