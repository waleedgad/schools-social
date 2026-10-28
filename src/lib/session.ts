import { cookies } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";
import type { PermissionOverrides, Role } from "./roles";

export type Membership = {
  role: Role;
  fullName: string;
  school: { id: string; name: string; defaultLocale: string; timezone: string; permissions: PermissionOverrides };
};

export type Workspace = { id: string; name: string; role: Role };

type MembershipRow = {
  role: Role;
  full_name: string;
  active: boolean;
  last_seen_at: string | null;
  school: { id: string; name: string; default_locale: string; timezone: string; permissions: PermissionOverrides | null } | null;
};

// The school shown is the one picked in the switcher (a cookie), else the
// first the person joined. Groups of schools and the owner use the switcher.
export const WORKSPACE_COOKIE = "school";

export async function getSession() {
  if (!isSupabaseConfigured) return { user: null, membership: null, workspaces: [] as Workspace[] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, membership: null, workspaces: [] as Workspace[] };

  const { data } = await supabase
    .from("memberships")
    .select("role, full_name, active, last_seen_at, school:schools(id, name, default_locale, timezone, permissions)")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at")
    .returns<MembershipRow[]>();

  const rows = (data ?? []).filter((r) => r.school);
  const picked = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const row = rows.find((r) => r.school!.id === picked) ?? rows[0];

  const membership: Membership | null = row?.school
    ? {
        role: row.role,
        fullName: row.full_name,
        school: {
          id: row.school.id,
          name: row.school.name,
          defaultLocale: row.school.default_locale,
          timezone: row.school.timezone,
          permissions: row.school.permissions ?? {},
        },
      }
    : null;

  // "Last seen" for the People page, at most once every 10 minutes.
  if (row?.school && (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 10 * 60_000)) {
    void supabase.rpc("touch_last_seen", { p_school: row.school.id });
  }

  const workspaces = rows.map((r) => ({ id: r.school!.id, name: r.school!.name, role: r.role }));
  return { user, membership, workspaces };
}

// For pages that need a signed-in staff member of a school.
export async function requireMembership(locale: string) {
  const { user, membership, workspaces } = await getSession();
  if (!user) redirect({ href: "/login", locale });
  if (!membership) redirect({ href: "/onboarding", locale });
  return { user: user!, membership: membership!, workspaces };
}

export function safeNext(next: unknown, fallback: string) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
    ? next
    : fallback;
}
