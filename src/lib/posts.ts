import "server-only";
import type { PostPhoto } from "./privacy";
import type { createClient } from "./supabase/server";

const PHOTO_COLUMNS = "id, storage_path, edited_path, edit_settings, width, height, contains_opted_out, ai_issues, check_status, alt_ar, alt_en, blur_boxes";

export async function loadPost(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data: post } = await supabase
    .from("posts")
    .select("*, event:events(id, title, event_date, class_name), category:categories(id, name_ar, name_en, color, hashtags, needs_extra_approval, frame_id)")
    .eq("id", id)
    .maybeSingle();
  if (!post) return null;
  const { data: rows } = await supabase
    .from("post_photos")
    .select(`position, photo:photos(${PHOTO_COLUMNS})`)
    .eq("post_id", id)
    .order("position");
  const photos = (rows ?? []).map((r) => r.photo as unknown as PostPhoto).filter(Boolean);
  return { post, photos };
}

export async function signedThumbs(supabase: Awaited<ReturnType<typeof createClient>>, paths: string[], seconds = 3600) {
  if (!paths.length) return new Map<string, string>();
  const { data } = await supabase.storage.from("photos").createSignedUrls(paths, seconds);
  return new Map((data ?? []).filter((s) => s.signedUrl).map((s) => [s.path as string, s.signedUrl as string]));
}
