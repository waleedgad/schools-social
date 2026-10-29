import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentRow } from "./students";

// What the Mac app tells the website. Tags and face data stay on this
// computer; the website only learns the class list (for the privacy check)
// and which sent photos show a student who must not appear in posts.

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

// Photos uploaded on the website (phones, teachers, photographers) wait
// for this Mac's face check before they can go into a post.
export type WaitingPhoto = { id: string; storage_path: string; original_name: string | null; taken_at: string | null; created_at: string; note: string | null; event: { title: string; event_date: string } | null };

export async function waitingPhotos(sb: SupabaseClient, schoolId: string, limit = 10) {
  const { data, error } = await sb
    .from("photos")
    .select("id, storage_path, original_name, taken_at, created_at, note, event:events(title, event_date)")
    .eq("school_id", schoolId)
    .eq("check_status", "waiting")
    .order("created_at")
    .limit(limit)
    .returns<WaitingPhoto[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function downloadPhoto(sb: SupabaseClient, storagePath: string) {
  const { data, error } = await sb.storage.from("photos").download(storagePath);
  if (error || !data) throw new Error(error?.message ?? "download");
  return Buffer.from(await data.arrayBuffer());
}

export async function finishCheck(sb: SupabaseClient, remoteId: string, optedOut: boolean) {
  const { error } = await sb.from("photos").update({ check_status: "ready", contains_opted_out: optedOut }).eq("id", remoteId);
  if (error) throw new Error(error.message);
}

// Deleting a photo on the Mac removes its web copy too, unless it is part of
// a post that went out (the post's record keeps it).
export async function removeWebCopies(sb: SupabaseClient, remoteIds: string[]) {
  if (!remoteIds.length) return [];
  const { data: used } = await sb.from("post_photos").select("photo_id, post:posts(status)").in("photo_id", remoteIds).returns<{ photo_id: string; post: { status: string } | null }[]>();
  const keep = new Set((used ?? []).filter((u) => ["published", "publishing"].includes(u.post?.status ?? "")).map((u) => u.photo_id));
  const gone = remoteIds.filter((id) => !keep.has(id));
  if (!gone.length) return [];
  const { data: rows } = await sb.from("photos").select("id, storage_path").in("id", gone);
  const { error } = await sb.from("photos").delete().in("id", gone);
  if (error) throw new Error(error.message);
  const paths = (rows ?? []).flatMap((r) => [r.storage_path as string, (r.storage_path as string).replace(/\.jpg$/, "_t.jpg")]);
  if (paths.length) await sb.storage.from("photos").remove(paths);
  return gone;
}

// Numbers for the Today screen.
export async function summary(sb: SupabaseClient, schoolId: string) {
  const count = async (status: string[]) => {
    const { count } = await sb.from("posts").select("id", { count: "exact", head: true }).eq("school_id", schoolId).in("status", status);
    return count ?? 0;
  };
  const [drafts, review, scheduled, failed] = await Promise.all([count(["draft"]), count(["in_review", "waiting_extra"]), count(["scheduled"]), count(["failed"])]);
  const { data: meta } = await sb.rpc("meta_status", { p_school: schoolId });
  const { data: upcoming } = await sb
    .from("posts")
    .select("id, status, caption_ar, caption_en, scheduled_at")
    .eq("school_id", schoolId)
    .in("status", ["scheduled", "in_review", "waiting_extra", "approved"])
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

// The web copy again, with the faces of people who can't appear blurred
// (or unblurred when nobody in it is left out any more).
export async function reblurWebCopy(sb: SupabaseClient, remoteId: string, file: string, boxes: [number, number, number, number][]) {
  const { data: row } = await sb.from("photos").select("storage_path").eq("id", remoteId).single();
  if (!row?.storage_path) return;
  const { prepare } = await import("./photo");
  const p = await prepare(file, boxes);
  const thumb = String(row.storage_path).replace(/\.jpg$/, "_t.jpg");
  const bucket = sb.storage.from("photos");
  const options = { contentType: "image/jpeg", upsert: true };
  const [a, b] = await Promise.all([bucket.upload(row.storage_path as string, p.full, options), bucket.upload(thumb, p.thumb, options)]);
  if (a.error || b.error) throw new Error((a.error ?? b.error)!.message);
  const { error } = await sb.from("photos").update({ blur_boxes: boxes, contains_opted_out: false }).eq("id", remoteId);
  if (error) throw new Error(error.message);
}
