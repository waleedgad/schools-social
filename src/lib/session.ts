import { redirect } from "@/i18n/navigation";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";
import type { Role } from "./roles";

export type Membership = {
  role: Role;
  fullName: string;
  school: { id: string; name: string; defaultLocale: string };
};

type MembershipRow = {
  role: Role;
  full_name: string;
  school: { id: string; name: string; default_locale: string } | null;
};

export async function getSession() {
  if (!isSupabaseConfigured) return { user: null, membership: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, membership: null };

  const { data } = await supabase
    .from("memberships")
    .select("role, full_name, school:schools(id, name, default_locale)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle<MembershipRow>();

  const membership: Membership | null = data?.school
    ? {
        role: data.role,
        fullName: data.full_name,
        school: {
          id: data.school.id,
          name: data.school.name,
          defaultLocale: data.school.default_locale,
        },
      }
    : null;

  return { user, membership };
}

// For pages that need a signed-in staff member of a school.
export async function requireMembership(locale: string) {
  const { user, membership } = await getSession();
  if (!user) redirect({ href: "/login", locale });
  if (!membership) redirect({ href: "/onboarding", locale });
  return { user: user!, membership: membership! };
}

export function safeNext(next: unknown, fallback: string) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
    ? next
    : fallback;
}
