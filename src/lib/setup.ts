import "server-only";
import type { createClient } from "./supabase/server";

export const SETUP_STEPS = ["accounts", "brand", "categories", "slots", "team", "mac", "students", "firstPost"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_LINKS: Record<SetupStep, string> = {
  accounts: "/accounts",
  brand: "/categories?tab=brand",
  categories: "/categories",
  slots: "/categories?tab=slots",
  team: "/staff",
  mac: "/help",
  students: "/students",
  firstPost: "/posts/new",
};

// What's done in setting up the school, worked out from its own data.
export async function setupState(supabase: Awaited<ReturnType<typeof createClient>>, schoolId: string) {
  const head = { count: "exact" as const, head: true };
  const [meta, school, cats, slots, team, mac, students, posted] = await Promise.all([
    supabase.rpc("meta_status", { p_school: schoolId }),
    supabase.from("schools").select("profile").eq("id", schoolId).single(),
    supabase.from("categories").select("id", head).eq("school_id", schoolId),
    supabase.from("time_slots").select("id", head).eq("school_id", schoolId),
    supabase.from("memberships").select("user_id", head).eq("school_id", schoolId),
    supabase.from("photos").select("id", head).eq("school_id", schoolId).eq("source", "desktop"),
    supabase.from("students").select("id", head).eq("school_id", schoolId),
    supabase.from("posts").select("id", head).eq("school_id", schoolId).eq("status", "published"),
  ]);
  const profile = (school.data?.profile ?? {}) as Record<string, unknown>;
  const done: Record<SetupStep, boolean> = {
    accounts: !!(meta.data as { page_id: string | null }[] | null)?.[0]?.page_id,
    brand: !!(profile.tone || profile.audience),
    categories: (cats.count ?? 0) > 0,
    slots: (slots.count ?? 0) > 0,
    team: (team.count ?? 0) > 1,
    mac: (mac.count ?? 0) > 0,
    students: (students.count ?? 0) > 0,
    firstPost: (posted.count ?? 0) > 0,
  };
  return { done, count: Object.values(done).filter(Boolean).length };
}
