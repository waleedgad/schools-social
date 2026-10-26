import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MetaError, publishToFacebook, publishToInstagram } from "./meta";

type Post = {
  id: string;
  school_id: string;
  caption_ar: string | null;
  caption_en: string | null;
  hashtags: string | null;
  platforms: string[];
  fb_post_id: string | null;
  ig_media_id: string | null;
};

export function captionText(p: Pick<Post, "caption_ar" | "caption_en" | "hashtags">) {
  return [p.caption_ar, p.caption_en, p.hashtags].map((s) => s?.trim()).filter(Boolean).join("\n\n");
}

// Publishes one post that is already marked "publishing". Runs with the
// server key. A platform that already worked is skipped on a retry.
async function publishClaimed(admin: SupabaseClient, post: Post) {
  const fail = (message: string) =>
    admin.from("posts").update({ status: "failed", publish_error: message.slice(0, 500) }).eq("id", post.id);

  const { data: rows } = await admin
    .from("post_photos")
    .select("position, photo:photos(storage_path, edited_path, contains_opted_out)")
    .eq("post_id", post.id)
    .order("position");
  const photos = (rows ?? [])
    .map((r) => r.photo as unknown as { storage_path: string; edited_path: string | null; contains_opted_out: boolean } | null)
    .filter((p) => p !== null);

  if (!photos.length) return fail("This post has no photos.");
  if (photos.some((p) => p.contains_opted_out)) return fail("A photo in this post is now marked not for posting.");

  const { data: meta } = await admin
    .from("meta_connections")
    .select("page_id, page_token, ig_user_id")
    .eq("school_id", post.school_id)
    .maybeSingle();
  if (!meta?.page_id || !meta.page_token) return fail("Connect the school's Facebook Page in settings first.");

  const { data: signed } = await admin.storage
    .from("photos")
    .createSignedUrls(photos.map((p) => p.edited_path ?? p.storage_path), 60 * 60);
  const urls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
  if (urls.length !== photos.length) return fail("Couldn't prepare the photo links.");

  const caption = captionText(post);
  let fb = post.fb_post_id;
  let ig = post.ig_media_id;
  try {
    if (post.platforms.includes("facebook") && !fb) {
      fb = await publishToFacebook(meta.page_id, meta.page_token, urls, caption);
      await admin.from("posts").update({ fb_post_id: fb }).eq("id", post.id);
    }
    if (post.platforms.includes("instagram") && !ig) {
      if (!meta.ig_user_id) throw new MetaError("No Instagram business account is linked to the Facebook Page.");
      ig = await publishToInstagram(meta.ig_user_id, meta.page_token, urls, caption);
      await admin.from("posts").update({ ig_media_id: ig }).eq("id", post.id);
    }
  } catch (e) {
    await admin.from("meta_connections").update({ last_error: String((e as Error).message).slice(0, 300) }).eq("school_id", post.school_id);
    return fail(e instanceof MetaError ? e.message : "Publishing failed. Try again in a few minutes.");
  }

  await admin
    .from("posts")
    .update({ status: "published", published_at: new Date().toISOString(), publish_error: null })
    .eq("id", post.id);
  await admin.from("meta_connections").update({ last_error: null }).eq("school_id", post.school_id);
  await admin.from("audit_log").insert({ school_id: post.school_id, action: "post.published", target: post.id, details: { fb, ig } });
}

const COLUMNS = "id, school_id, caption_ar, caption_en, hashtags, platforms, fb_post_id, ig_media_id";

// Takes the post only if it is still waiting, so two runs never post twice.
async function claim(admin: SupabaseClient, id: string, from: "scheduled" | "failed") {
  const { data: current } = await admin.from("posts").select("attempts").eq("id", id).maybeSingle();
  const { data } = await admin
    .from("posts")
    .update({ status: "publishing", attempts: (current?.attempts ?? 0) + 1 })
    .eq("id", id)
    .eq("status", from)
    .select(COLUMNS)
    .maybeSingle<Post>();
  return data;
}

export async function publishNow(admin: SupabaseClient, id: string) {
  const post = (await claim(admin, id, "scheduled")) ?? (await claim(admin, id, "failed"));
  if (post) await publishClaimed(admin, post);
}

// Called every few minutes by the scheduler.
export async function publishDue(admin: SupabaseClient, limit = 5) {
  const { data: due } = await admin
    .from("posts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(limit);
  let published = 0;
  for (const { id } of due ?? []) {
    const post = await claim(admin, id, "scheduled");
    if (!post) continue;
    await publishClaimed(admin, post);
    published++;
  }

  // A run that died half way leaves posts stuck in "publishing"; after
  // 15 minutes hand them back so someone can retry.
  await admin
    .from("posts")
    .update({ status: "failed", publish_error: "Publishing was interrupted. Check the page, then retry." })
    .eq("status", "publishing")
    .lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString());
  return published;
}
