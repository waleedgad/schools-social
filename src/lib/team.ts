import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isComms, type Role } from "@/lib/roles";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// Pages for class teachers (faces to check, coverage, yearbook names, shot
// lists). Teachers can't read the class lists or the library themselves, so
// the server reads only their own classes with the service key.

export type ClassStudent = { code: string; name: string; nameAr: string | null; nameEn: string; className: string | null };

export async function myClasses(supabase: SupabaseClient, schoolId: string, userId: string) {
  const { data } = await supabase.from("memberships").select("classes").eq("school_id", schoolId).eq("user_id", userId).maybeSingle();
  return ((data?.classes as string[] | undefined) ?? []).filter(Boolean);
}

// Which classes this person may see: comms see every class, teachers theirs.
export async function classScope(supabase: SupabaseClient, schoolId: string, userId: string, role: Role) {
  if (isComms(role) || role === "principal") return { all: true, classes: [] as string[] };
  return { all: false, classes: await myClasses(supabase, schoolId, userId) };
}

export function staffClient(supabase: SupabaseClient) {
  return isAdminConfigured ? createAdminClient() : supabase;
}

export async function classStudents(supabase: SupabaseClient, schoolId: string, scope: { all: boolean; classes: string[] }, locale: string) {
  if (!scope.all && !scope.classes.length) return [] as ClassStudent[];
  let q = staffClient(supabase).from("students").select("student_code, full_name, name_ar, class_name").eq("school_id", schoolId).eq("active", true).not("student_code", "is", null);
  if (!scope.all) q = q.in("class_name", scope.classes);
  const { data } = await q.order("class_name").order("full_name").limit(5000);
  return (data ?? []).map((s) => ({
    code: s.student_code as string,
    nameEn: s.full_name as string,
    nameAr: (s.name_ar as string | null) ?? null,
    name: (locale === "ar" ? (s.name_ar as string | null) || (s.full_name as string) : (s.full_name as string)) ?? "",
    className: (s.class_name as string | null) ?? null,
  }));
}

export async function signPaths(supabase: SupabaseClient, paths: string[], seconds = 3600) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return new Map<string, string>();
  const { data } = await staffClient(supabase).storage.from("photos").createSignedUrls(list, seconds);
  return new Map((data ?? []).filter((s) => s.signedUrl).map((s) => [s.path as string, s.signedUrl as string]));
}

// Arabic and English spellings of one name match each other in search:
// "Mohamed", "Mohammed" and "Muhammad" all find the same student, and
// أ/إ/آ/ا, ة/ه, ى/ي count as the same letter.
export function nameKey(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/(^|\s)(al|el)[- ]?(?=[^aeiou\s-])/g, "$1")
    .replace(/^ال/g, "")
    .replace(/ ال/g, " ")
    .replace(/(.)\1+/g, "$1")
    .replace(/[aeiouy]/g, "")
    .replace(/ph/g, "f")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
