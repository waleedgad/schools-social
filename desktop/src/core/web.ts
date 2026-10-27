import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentRow } from "./students";

// What the Mac app tells the website. Tags and face data stay on this
// computer; the website only learns the class list (for the privacy check)
// and which sent photos show a child who must not appear in posts.

export async function pushStudents(sb: SupabaseClient, schoolId: string, students: StudentRow[]) {
  const rows = students.map((s) => ({
    school_id: schoolId,
    student_code: s.id,
    full_name: (s.name_en || s.name_ar || s.id).slice(0, 120),
    name_ar: s.name_ar,
    class_name: s.class_name,
    consent_social: s.can_post ? "yes" : "no",
  }));
  let sent = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("students").upsert(rows.slice(i, i + 500), { onConflict: "school_id,student_code" });
    if (error) throw new Error(error.message);
    sent += Math.min(500, rows.length - i);
  }
  return sent;
}

export async function setOptedOut(sb: SupabaseClient, changes: { remoteId: string; optedOut: boolean }[]) {
  for (const value of [true, false]) {
    const ids = changes.filter((c) => c.optedOut === value).map((c) => c.remoteId);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from("photos").update({ contains_opted_out: value }).in("id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
  }
}

export async function createDraft(sb: SupabaseClient, o: { schoolId: string; userId: string; eventId: string | null; photoIds: string[] }) {
  const { data: post, error } = await sb.from("posts").insert({ school_id: o.schoolId, event_id: o.eventId, created_by: o.userId }).select("id").single();
  if (error || !post) throw new Error(error?.message ?? "post");
  const { error: photoError } = await sb
    .from("post_photos")
    .insert(o.photoIds.slice(0, 20).map((photo_id, position) => ({ post_id: post.id, photo_id, school_id: o.schoolId, position })));
  if (photoError) {
    await sb.from("posts").delete().eq("id", post.id);
    throw new Error(photoError.message);
  }
  await sb.from("audit_log").insert({ school_id: o.schoolId, user_id: o.userId, action: "post.created", target: post.id, details: { photos: o.photoIds.length, from: "mac" } });
  return post.id as string;
}

// Numbers for the Today screen.
export async function summary(sb: SupabaseClient, schoolId: string) {
  const count = async (status: string[]) => {
    const { count } = await sb.from("posts").select("id", { count: "exact", head: true }).eq("school_id", schoolId).in("status", status);
    return count ?? 0;
  };
  const [drafts, review, scheduled, failed] = await Promise.all([count(["draft"]), count(["in_review", "approved"]), count(["scheduled"]), count(["failed"])]);
  const { data: meta } = await sb.rpc("meta_status", { p_school: schoolId });
  const { data: upcoming } = await sb
    .from("posts")
    .select("id, status, caption_ar, caption_en, scheduled_at")
    .eq("school_id", schoolId)
    .in("status", ["scheduled", "in_review", "approved"])
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(6);
  return {
    drafts,
    review,
    scheduled,
    failed,
    facebook: !!(meta as { page_id?: string }[] | null)?.[0]?.page_id,
    instagram: !!(meta as { ig_username?: string }[] | null)?.[0]?.ig_username,
    upcoming: upcoming ?? [],
  };
}
