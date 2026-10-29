import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// A head of stage (an extra approver limited to some stages) only sees posts
// about classes in their stages, plus whole-school posts with no class.
// Returns null when the person sees everything.
export async function stageScope(supabase: SupabaseClient, schoolId: string, userId: string) {
  const { data: me } = await supabase.from("memberships").select("role, stages").eq("school_id", schoolId).eq("user_id", userId).maybeSingle();
  const stages = (me?.stages ?? []) as string[];
  if (me?.role !== "principal" || !stages.length) return null;
  const { data } = await supabase.from("students").select("class_name, stage").eq("school_id", schoolId).in("stage", stages).not("class_name", "is", null).limit(5000);
  const mine = new Set((data ?? []).map((r) => r.class_name as string));
  return (className: string | null | undefined) => !className || mine.has(className);
}
