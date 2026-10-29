"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { sendEmail } from "@/lib/alerts";
import { isRole, type Role } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

async function adminContext(formData: FormData | string) {
  const locale = typeof formData === "string" ? formData : String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  if (membership.role !== "admin") redirect({ href: "/today", locale });
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

// Someone on leave keeps their history but can't sign in to the school.
export async function setActive(formData: FormData) {
  const { locale, user, schoolId, supabase, audit } = await adminContext(formData);
  const userId = String(formData.get("userId") ?? "");
  const active = formData.get("active") === "1";
  if (userId !== user.id) {
    await supabase.from("memberships").update({ active }).eq("school_id", schoolId).eq("user_id", userId);
    await audit(active ? "member.activated" : "member.deactivated", userId);
  }
  revalidatePath(`/${locale}/staff`);
}

// A teacher's classes help the Mac guess the class in their photos.
export async function setClasses(formData: FormData) {
  const { locale, schoolId, supabase } = await adminContext(formData);
  const userId = String(formData.get("userId") ?? "");
  const classes = String(formData.get("classes") ?? "").split(/[,،]/).map((c) => c.trim().slice(0, 60)).filter(Boolean).slice(0, 20);
  await supabase.from("memberships").update({ classes }).eq("school_id", schoolId).eq("user_id", userId);
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

  redirect({ href: "/today", locale });
}

export type StaffRow = { name: string; email: string; phone: string; role: string; classes: string };

const ROLE_WORDS: Record<string, Role> = {
  admin: "admin", "مسؤول": "admin", "مدير النظام": "admin",
  "comms lead": "comms_lead", "head of comms": "comms_lead", "مسؤول الإعلام": "comms_lead", "رئيس الإعلام": "comms_lead",
  comms: "comms", marketing: "comms", media: "comms", "إعلام": "comms", "تسويق": "comms",
  principal: "principal", "head of stage": "principal", "مدير": "principal", "مدير المدرسة": "principal", "مدير المرحلة": "principal", "ناظر": "principal",
  teacher: "teacher", "معلم": "teacher", "معلمة": "teacher", "مدرس": "teacher", "مدرسة": "teacher",
  staff: "staff", "موظف": "staff", "موظفة": "staff", "إداري": "staff",
  photographer: "photographer", "مصور": "photographer", "مصورة": "photographer",
};

// The staff list from a spreadsheet: one invite per person, by email or
// phone (the link then goes out on WhatsApp). People already invited and
// waiting are skipped.
export async function inviteMany(locale: string, rows: StaffRow[]) {
  const { user, schoolId, supabase, audit } = await adminContext(locale);
  const { data: waiting } = await supabase.from("invites").select("email, phone").eq("school_id", schoolId).is("accepted_at", null);
  const have = new Set((waiting ?? []).flatMap((w) => [w.email, w.phone].filter(Boolean).map((x) => String(x).toLowerCase())));
  const clean = rows
    .slice(0, 300)
    .map((r) => {
      const email = r.email.trim().toLowerCase();
      const phone = r.phone.replace(/[^\d+]/g, "").slice(0, 30);
      const role = isRole(r.role.trim()) ? (r.role.trim() as Role) : (ROLE_WORDS[r.role.trim().toLowerCase()] ?? "teacher");
      return {
        school_id: schoolId,
        invited_by: user.id,
        email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
        phone: phone.length >= 8 ? phone : null,
        full_name: r.name.trim().slice(0, 120) || null,
        role,
        classes: r.classes.split(/[,،;]/).map((c) => c.trim()).filter(Boolean).slice(0, 20),
      };
    })
    .filter((r) => (r.email || r.phone) && !have.has(String(r.email ?? r.phone).toLowerCase()));
  if (clean.length) {
    const { error } = await supabase.from("invites").insert(clean);
    if (error) return { ok: false, count: 0 };
  }
  await audit("invite.bulk", String(clean.length));
  revalidatePath(`/${locale}/staff`);
  return { ok: true, count: clean.length };
}

export async function emailInvite(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await adminContext(formData);
  const id = String(formData.get("id") ?? "");
  const link = String(formData.get("link") ?? "");
  const { data: inv } = await supabase.from("invites").select("email, full_name, role").eq("id", id).eq("school_id", schoolId).maybeSingle();
  const { data: school } = await supabase.from("schools").select("name").eq("id", schoolId).single();
  const ok = inv?.email && link.includes("/invite/") ? await sendEmail([inv.email as string], `${school?.name ?? ""}: School Social Hub`, `${inv.full_name ? `${inv.full_name},\n\n` : ""}${school?.name} invited you to School Social Hub.\nمدرسة ${school?.name} تدعوك إلى School Social Hub.\n\n${link}`) : false;
  if (ok) await audit("invite.emailed", String(inv?.email));
  redirect({ href: { pathname: "/staff", query: { emailed: ok ? "1" : "0" } }, locale });
}
