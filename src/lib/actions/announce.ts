"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// The announcement image is made in the browser and uploaded first; this
// turns it into a draft post with the text as its captions.
export async function createAnnouncement(
  locale: string,
  input: { photoId: string; captionAr: string; captionEn: string; category: string | null; day: string | null },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, "writePosts", membership.school.permissions)) return { ok: false, error: "role" };
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const { data: photo } = await supabase.from("photos").select("id").eq("id", input.photoId).eq("school_id", schoolId).eq("source", "design").maybeSingle();
  if (!photo) return { ok: false, error: "photo" };
  const scheduledAt = input.day && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? new Date(`${input.day}T15:00:00Z`).toISOString() : null;
  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      school_id: schoolId,
      created_by: user.id,
      category_id: input.category || null,
      caption_ar: input.captionAr.slice(0, 2200) || null,
      caption_en: input.captionEn.slice(0, 2200) || null,
      scheduled_at: scheduledAt,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !post) return { ok: false, error: "post" };
  await supabase.from("post_photos").insert({ post_id: post.id, photo_id: photo.id, school_id: schoolId, position: 0 });
  await supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action: "post.announcement", target: post.id, details: {} });
  revalidatePath(`/${locale}/posts`);
  return { ok: true, id: post.id as string };
}
