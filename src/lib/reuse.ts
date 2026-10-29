import "server-only";
import { publishStory } from "@/lib/meta";
import type { PostCtx } from "@/lib/post-core";
import { can } from "@/lib/roles";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// Use a post again: as an Instagram story, or as a recap post that gathers
// the best photo of each post from the same week. (A post's photos go into
// a yearbook from the Mac, where the yearbooks are made.)
export type ReuseResult = { ok: true; id?: string; story?: "sent" | "planned" } | { ok: false; error: string };

export async function reusePost(ctx: PostCtx, id: string, kind: "story" | "recap", locale: "ar" | "en"): Promise<ReuseResult> {
  const { supabase, membership, userId } = ctx;
  const schoolId = membership.school.id;
  const perms = membership.school.permissions;
  if (!can(membership.role, "writePosts", perms)) return { ok: false, error: "role" };
  const { data: post } = await supabase.from("posts").select("id, status, published_at, scheduled_at, category_id, event_id, platforms, make_story").eq("id", id).eq("school_id", schoolId).maybeSingle();
  if (!post) return { ok: false, error: "missing" };
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) => supabase.from("audit_log").insert({ school_id: schoolId, user_id: userId, action, target, details });

  if (kind === "story") {
    // Not out yet: the story simply goes out with the post.
    if (post.status !== "published") {
      await supabase.from("posts").update({ make_story: true }).eq("id", id);
      await audit("post.story_planned", id);
      return { ok: true, story: "planned" };
    }
    if (!can(membership.role, "publish", perms) || !isAdminConfigured) return { ok: false, error: "role" };
    const admin = createAdminClient();
    const { data: meta } = await admin.from("meta_connections").select("ig_user_id, page_token").eq("school_id", schoolId).maybeSingle();
    if (!meta?.ig_user_id || !meta.page_token) return { ok: false, error: "instagram" };
    const { data: first } = await supabase.from("post_photos").select("photo:photos(storage_path, edited_path)").eq("post_id", id).order("position").limit(1).maybeSingle();
    const photo = first?.photo as unknown as { storage_path: string; edited_path: string | null } | null;
    if (!photo) return { ok: false, error: "photos" };
    const { data: signed } = await admin.storage.from("photos").createSignedUrl(photo.edited_path ?? photo.storage_path, 3600);
    if (!signed?.signedUrl) return { ok: false, error: "photos" };
    try {
      await publishStory(meta.ig_user_id as string, meta.page_token as string, signed.signedUrl);
    } catch {
      return { ok: false, error: "failed" };
    }
    await audit("post.story_sent", id);
    return { ok: true, story: "sent" };
  }

  // Recap: the week around this post, best first photo of each post.
  const at = Date.parse((post.published_at ?? post.scheduled_at ?? new Date().toISOString()) as string);
  const from = new Date(at - 3.5 * 86400_000).toISOString();
  const to = new Date(at + 3.5 * 86400_000).toISOString();
  const { data: week } = await supabase
    .from("posts")
    .select("id, published_at, scheduled_at, post_photos(position, photo_id)")
    .eq("school_id", schoolId)
    .in("status", ["published", "scheduled", "approved"])
    .or(`and(published_at.gte.${from},published_at.lt.${to}),and(scheduled_at.gte.${from},scheduled_at.lt.${to})`)
    .limit(30);
  const photos = [id, ...(week ?? []).map((p) => p.id as string).filter((x) => x !== id)]
    .map((pid) => (week ?? []).find((p) => p.id === pid) ?? null)
    .flatMap((p) => (p ? [...((p.post_photos ?? []) as { position: number; photo_id: string }[])].sort((a, b) => a.position - b.position).slice(0, 1).map((x) => x.photo_id) : []));
  if (!photos.length) {
    const { data: own } = await supabase.from("post_photos").select("photo_id").eq("post_id", id).order("position").limit(10);
    photos.push(...(own ?? []).map((r) => r.photo_id as string));
  }
  const unique = [...new Set(photos)].slice(0, 10);
  const { data: copy } = await supabase
    .from("posts")
    .insert({ school_id: schoolId, created_by: userId, category_id: post.category_id, platforms: post.platforms, status: "draft", idea: locale === "ar" ? "ملخص الأسبوع" : "Recap of the week" })
    .select("id")
    .single();
  if (!copy) return { ok: false, error: "save" };
  if (unique.length) await supabase.from("post_photos").insert(unique.map((photo_id, position) => ({ post_id: copy.id, photo_id, school_id: schoolId, position })));
  await audit("post.recap", copy.id, { from: id, photos: unique.length });
  return { ok: true, id: copy.id as string };
}
