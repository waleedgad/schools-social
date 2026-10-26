import "server-only";
import type { PostPhoto } from "./privacy";
import type { createClient } from "./supabase/server";

const PHOTO_COLUMNS = "id, storage_path, edited_path, edit_settings, width, height, contains_opted_out, ai_issues";

export async function loadPost(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data: post } = await supabase
    .from("posts")
    .select("*, event:events(id, title, event_date, class_name)")
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
