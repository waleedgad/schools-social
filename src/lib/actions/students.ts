"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { parseConsent, type StudentInput } from "@/lib/student-import";
import { createClient } from "@/lib/supabase/server";

async function curator(locale: string) {
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, "manageConsent")) redirect({ href: "/dashboard", locale });
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) =>
    supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action, target, details });
  return { schoolId, supabase, audit };
}

const MAX_IMPORT = 3000;

export async function importStudents(locale: string, students: StudentInput[]) {
  const { schoolId, supabase, audit } = await curator(locale);
  const rows = students.slice(0, MAX_IMPORT).map((s) => ({
    school_id: schoolId,
    full_name: String(s.full_name).trim().slice(0, 120),
    class_name: s.class_name ? String(s.class_name).trim().slice(0, 60) : null,
    parent_phone: s.parent_phone ? String(s.parent_phone).trim().slice(0, 30) : null,
    consent_social: parseConsent(s.consent_social),
  }));

  const { error } = await supabase.from("students").insert(rows.filter((r) => r.full_name.length >= 2));
  if (error) redirect({ href: { pathname: "/students", query: { error: "import" } }, locale });

  await audit("students.imported", String(rows.length));
  redirect({ href: { pathname: "/students", query: { imported: String(rows.length) } }, locale });
}

export async function addStudent(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { schoolId, supabase, audit } = await curator(locale);
  const fullName = String(formData.get("fullName") ?? "").trim();

  const { error } = await supabase.from("students").insert({
    school_id: schoolId,
    full_name: fullName,
    class_name: String(formData.get("className") ?? "").trim() || null,
    parent_phone: String(formData.get("parentPhone") ?? "").trim() || null,
    consent_social: parseConsent(formData.get("consent")),
  });
  if (error) redirect({ href: { pathname: "/students", query: { error: "add" } }, locale });

  await audit("student.added", fullName);
  revalidatePath(`/${locale}/students`);
}

export async function setConsent(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { supabase, audit } = await curator(locale);
  const id = String(formData.get("id") ?? "");
  const value = String(formData.get("consent") ?? "unknown");
  const consent = value === "yes" || value === "no" ? value : "unknown";

  await supabase.from("students").update({ consent_social: consent }).eq("id", id);
  await audit("student.consent_changed", id, { consent });
  revalidatePath(`/${locale}/students`);
}

export async function removeStudent(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { supabase, audit } = await curator(locale);
  const id = String(formData.get("id") ?? "");

  await supabase.from("students").delete().eq("id", id);
  await audit("student.removed", id);
  revalidatePath(`/${locale}/students`);
}
