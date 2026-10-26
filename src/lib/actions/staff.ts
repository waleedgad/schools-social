"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { isRole } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

async function adminContext(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  if (membership.role !== "admin") redirect({ href: "/dashboard", locale });
  const supabase = await createClient();

  const audit = (action: string, target: string, details: Record<string, unknown> = {}) =>
    supabase.from("audit_log").insert({
      school_id: membership.school.id,
      user_id: user.id,
      action,
      target,
      details,
    });

  return { locale, user, schoolId: membership.school.id, supabase, audit };
}

export async function createInvite(formData: FormData) {
  const { locale, user, schoolId, supabase, audit } = await adminContext(formData);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role");

  const { error } = isRole(role)
    ? await supabase.from("invites").insert({ school_id: schoolId, email, role, invited_by: user.id })
    : { error: true };
  if (error) redirect({ href: { pathname: "/staff", query: { error: "1" } }, locale });

  await audit("invite.created", email, { role });
  revalidatePath(`/${locale}/staff`);
}

export async function revokeInvite(formData: FormData) {
  const { locale, supabase, audit } = await adminContext(formData);
  const id = String(formData.get("id") ?? "");

  const { data } = await supabase.from("invites").delete().eq("id", id).select("email").maybeSingle();
  if (data) await audit("invite.revoked", data.email);
  revalidatePath(`/${locale}/staff`);
}

export async function changeRole(formData: FormData) {
  const { locale, user, schoolId, supabase, audit } = await adminContext(formData);
  const userId = String(formData.get("userId") ?? "");
  const role = formData.get("role");

  // An admin can't change their own role, so a school always keeps one admin.
  if (isRole(role) && userId !== user.id) {
    await supabase.from("memberships").update({ role }).eq("school_id", schoolId).eq("user_id", userId);
    await audit("member.role_changed", userId, { role });
  }
  revalidatePath(`/${locale}/staff`);
}

export async function removeMember(formData: FormData) {
  const { locale, user, schoolId, supabase, audit } = await adminContext(formData);
  const userId = String(formData.get("userId") ?? "");

  if (userId !== user.id) {
    await supabase.from("memberships").delete().eq("school_id", schoolId).eq("user_id", userId);
    await audit("member.removed", userId);
  }
  revalidatePath(`/${locale}/staff`);
}

export async function acceptInvite(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();

  const { error } = await supabase.rpc("accept_invite", {
    p_token: token,
    p_full_name: String(formData.get("fullName") ?? ""),
  });
  if (error) redirect({ href: { pathname: `/invite/${token}`, query: { error: "1" } }, locale });

  redirect({ href: "/dashboard", locale });
}
