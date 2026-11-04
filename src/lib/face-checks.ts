import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { staffClient } from "@/lib/team";

// B-03: the small face pictures the Mac uploads for "Is this …?" questions
// are deleted as soon as the question is answered, and unanswered ones after
// 14 days. Only this school's own check pictures can be removed.

type Row = { id: string; crop_path: string | null; context_path: string | null };

export async function removeCheckPictures(supabase: SupabaseClient, schoolId: string, rows: Row[]) {
  const paths = rows.flatMap((r) => [r.crop_path, r.context_path]).filter((p): p is string => !!p && p.startsWith(`${schoolId}/checks/`));
  if (!paths.length) return 0;
  const client = staffClient(supabase);
  await client.storage.from("photos").remove(paths);
  await client.from("face_checks").update({ crop_path: null, context_path: null }).eq("school_id", schoolId).in("id", rows.map((r) => r.id));
  return paths.length;
}

// Questions nobody answered in 14 days: pictures and questions go.
export async function clearExpiredChecks(supabase: SupabaseClient, schoolId: string) {
  const client = staffClient(supabase);
  const { data } = await client.from("face_checks").select("id, crop_path, context_path").eq("school_id", schoolId).is("answer", null).lt("expires_at", new Date().toISOString()).limit(500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return 0;
  const paths = rows.flatMap((r) => [r.crop_path, r.context_path]).filter((p): p is string => !!p && p.startsWith(`${schoolId}/checks/`));
  if (paths.length) await client.storage.from("photos").remove(paths);
  await client.from("face_checks").delete().eq("school_id", schoolId).in("id", rows.map((r) => r.id));
  return rows.length;
}
