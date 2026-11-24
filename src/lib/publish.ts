import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "./alerts";
import { readsRight } from "./captions";
import { addComment, findFacebookPost, type IgSaved, MetaError, permalinkOf, publishStory, publishToFacebook, publishToInstagram } from "./meta";
import { fitsInstagram, instagramProblems, nextRetry, type MetaReason } from "./meta-errors";
import { stateWithServiceKey } from "./plan";
import { isOwnPath } from "./paths";

type Post = {
  id: string;
  school_id: string;
  caption_ar: string | null;
  caption_en: string | null;
  caption_ig: string | null;
  hashtags: string | null;
  first_comment: string | null;
  platforms: string[];
  make_story: boolean;
  collaborators: string[];
  fb_post_id: string | null;
  ig_media_id: string | null;
  ig_container_id: string | null;
  attempts: number;
  publish_reason: string | null;
};

export function captionText(p: Pick<Post, "caption_ar" | "caption_en" | "hashtags">) {
  // readsRight: an Arabic line that starts with an English name still reads right-to-left on Facebook and Instagram.
  return readsRight([p.caption_ar, p.caption_en, p.hashtags].map((s) => s?.trim()).filter(Boolean).join("\n\n"));
}

// Instagram can have its own caption (shorter, hashtags inside).
export function instagramText(p: Pick<Post, "caption_ar" | "caption_en" | "caption_ig" | "hashtags">) {
  return p.caption_ig?.trim() ? readsRight(p.caption_ig.trim()) : captionText(p);
}

// Publishes one post that is already marked "publishing". Runs with the
// server key. A platform that already worked is skipped on a retry.
async function publishClaimed(admin: SupabaseClient, post: Post) {
  // reason (release 0.17): a short code the screens show in plain Arabic or
  // English; message keeps Meta's own words.
  const fail = async (message: string, reason: MetaReason | "check" | "connect" = "other") => {
    await admin.from("posts").update({ status: "failed", publish_error: message.slice(0, 500), publish_reason: reason, retry_at: null }).eq("id", post.id);
    await notify(post.school_id, "failed", "A post didn't go out · لم يُنشر منشور", message.slice(0, 300), `/posts/${post.id}`, { key: `failed:${post.id}:${post.attempts}` });
  };

  const { data: rows } = await admin
    .from("post_photos")
    .select("position, photo:photos(storage_path, edited_path, contains_opted_out, check_status, width, height)")
    .eq("post_id", post.id)
    .order("position");
  type Photo = { storage_path: string; edited_path: string | null; contains_opted_out: boolean; check_status: string; width: number | null; height: number | null };
  const photos = (rows ?? []).map((r) => r.photo as unknown as Photo | null).filter((p) => p !== null);

  if (!photos.length && post.platforms.includes("instagram")) return fail("Instagram posts need at least one photo.", "check");
  if (photos.some((p) => p.contains_opted_out)) return fail("A photo in this post is now marked not for posting.", "check");
  if (photos.some((p) => p.check_status === "waiting")) return fail("A photo hasn't been checked on the Mac yet.", "check");

  const { data: meta } = await admin
    .from("meta_connections")
    .select("page_id, page_token, ig_user_id, fb_paused, ig_paused, needs_reconnect")
    .eq("school_id", post.school_id)
    .maybeSingle();
  if (!meta?.page_id || !meta.page_token) return fail("Connect the school's Facebook Page in settings first.", "connect");
  // Release 0.17: the key stopped working; nothing is tried until someone reconnects.
  // (No alert per post: the school already got one "Reconnect Facebook".)
  if (meta.needs_reconnect) {
    await admin.from("posts").update({ status: "failed", publish_error: "Facebook signed the school out. Reconnect on the Accounts page, then try again.", publish_reason: "reconnect", retry_at: null }).eq("id", post.id);
    return;
  }

  const toInstagram = post.platforms.includes("instagram") && !post.ig_media_id && !meta.ig_paused;
  if (toInstagram) {
    // The same rules the post screen checks, again just before posting (the
    // post may have changed since it was approved).
    const problems = instagramProblems(instagramText(post), photos.length);
    if (problems.length) return fail(`Instagram would refuse this post: ${problems.join(", ")}.`, problems.some((x) => x === "no_photo" || x === "too_many_photos") ? "photo" : "caption");
    // Photos edited on the website (Fix shape) are 4:5; the width and height
    // saved are of the original, so only unedited photos are checked here.
    if (photos.some((p) => !p.edited_path && !fitsInstagram(p.width ?? 0, p.height ?? 0))) return fail("A photo has a shape Instagram doesn't take. Use Fix shape on the post.", "photo");
  }

  let urls: string[] = [];
  if (photos.length) {
    // S-21N-03: only the school's own files are signed with the server key.
    if (photos.some((p) => !isOwnPath(post.school_id, p.edited_path ?? p.storage_path))) return fail("A photo in this post belongs to another school.", "check");
    const { data: signed } = await admin.storage
      .from("photos")
      .createSignedUrls(photos.map((p) => p.edited_path ?? p.storage_path), 60 * 60);
    urls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
    if (urls.length !== photos.length) return fail("Couldn't prepare the photo links.", "busy");
  }

  let fb = post.fb_post_id;
  let ig = post.ig_media_id;
  try {
    if (post.platforms.includes("facebook") && !fb && !meta.fb_paused) {
      const text = captionText(post);
      // An earlier try that timed out may have posted after all (release 0.17).
      if (post.attempts > 1 && post.publish_reason === "busy") fb = await findFacebookPost(meta.page_id, meta.page_token, text);
      if (!fb) {
        fb = await publishToFacebook(meta.page_id, meta.page_token, urls, text);
        if (post.first_comment?.trim()) await addComment(fb, meta.page_token, post.first_comment.trim()).catch(() => null);
      }
      await admin.from("posts").update({ fb_post_id: fb, fb_url: await permalinkOf("facebook", fb, meta.page_token) }).eq("id", post.id);
    }
    if (toInstagram) {
      if (!meta.ig_user_id) throw new MetaError("No Instagram business account is linked to the Facebook Page.", "reconnect");
      const saved: IgSaved = {
        container: post.ig_container_id,
        onContainer: async (id) => void (await admin.from("posts").update({ ig_container_id: id }).eq("id", post.id)),
      };
      ig = await publishToInstagram(meta.ig_user_id, meta.page_token, urls, instagramText(post), post.collaborators, saved);
      await admin.from("posts").update({ ig_media_id: ig, ig_url: await permalinkOf("instagram", ig, meta.page_token) }).eq("id", post.id);
      // Only on the try that made the post (not when an earlier one is found).
      const fresh = !saved.found;
      if (fresh && post.first_comment?.trim()) await addComment(ig, meta.page_token, post.first_comment.trim()).catch(() => null);
      if (fresh && post.make_story && urls[0]) await publishStory(meta.ig_user_id, meta.page_token, urls[0]).catch(() => null);
    }
  } catch (e) {
    const err = e instanceof MetaError ? e : new MetaError("Publishing failed. Try again in a few minutes.", "busy");
    await admin.from("meta_connections").update({ last_error: err.message.slice(0, 300) }).eq("school_id", post.school_id);
    if (err.reason === "reconnect") {
      // Mark the account once; one alert for the school, not one per post.
      const { data: marked } = await admin
        .from("meta_connections")
        .update({ needs_reconnect: true, reconnect_since: new Date().toISOString() })
        .eq("school_id", post.school_id)
        .eq("needs_reconnect", false)
        .select("school_id");
      if (marked?.length) {
        await notify(post.school_id, "failed", "Reconnect Facebook · أعد ربط فيسبوك", "Facebook signed the school out, so posts can't go out. Open Accounts and press Reconnect.\nفيسبوك أخرج حساب المدرسة، لذلك لا تُنشر المنشورات. افتح الحسابات واضغط إعادة الربط.", "/accounts", { key: `reconnect:${Date.now()}` });
      }
      await admin.from("posts").update({ status: "failed", publish_error: err.message.slice(0, 500), publish_reason: "reconnect", retry_at: null }).eq("id", post.id);
      return;
    }
    // Meta busy: back in line, tried again after 5, 15 and 45 minutes.
    const retry = err.reason === "busy" ? nextRetry(post.attempts) : null;
    if (retry) {
      await admin.from("posts").update({ status: "scheduled", retry_at: retry.toISOString(), publish_error: err.message.slice(0, 500), publish_reason: "busy" }).eq("id", post.id);
      return;
    }
    return fail(err.message, err.reason);
  }

  await admin
    .from("posts")
    .update({ status: "published", published_at: new Date().toISOString(), publish_error: null, publish_reason: null, retry_at: null })
    .eq("id", post.id);
  await admin.from("meta_connections").update({ last_error: null }).eq("school_id", post.school_id);
  await admin.from("audit_log").insert({ school_id: post.school_id, action: "post.published", target: post.id, details: { fb, ig } });
}

const COLUMNS = "id, school_id, caption_ar, caption_en, caption_ig, hashtags, first_comment, platforms, make_story, collaborators, fb_post_id, ig_media_id, ig_container_id, attempts, publish_reason";

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
  // A school that is read-only or blocked keeps its posts; nothing goes out.
  const { data: row } = await admin.from("posts").select("school_id").eq("id", id).maybeSingle();
  if (!row || (await stateWithServiceKey(admin, row.school_id as string)) !== "active") return;
  const post = (await claim(admin, id, "scheduled")) ?? (await claim(admin, id, "failed"));
  if (post) await publishClaimed(admin, post);
}

// Called every few minutes by the scheduler.
export async function publishDue(admin: SupabaseClient, limit = 5, budgetMs = 40_000) {
  const now = new Date().toISOString();

  // The extra approver didn't answer in time: go ahead or keep waiting, as
  // the school chose in settings.
  const { data: overdue } = await admin.rpc("overdue_extra");
  for (const o of (overdue ?? []) as { id: string; school_id: string; action: string }[]) {
    if (o.action !== "go") continue;
    await admin.from("posts").update({ status: "scheduled" }).eq("id", o.id).eq("status", "waiting_extra");
    await admin.from("audit_log").insert({ school_id: o.school_id, action: "post.extra_timeout", target: o.id });
  }

  // Paused schools keep their queue; nothing goes out until they resume.
  const { data: paused, error: pausedError } = await admin.from("schools").select("id").gt("posting_paused_until", now);
  // Schools that are read-only or blocked keep their scheduled posts too;
  // they go out once the school is active again.
  const { data: states, error: statesError } = await admin.rpc("all_school_states");
  // S-21N-02: if either list can't be read, nobody's posts go out this run
  // (fail closed), instead of treating every school as active.
  if (pausedError || statesError || !Array.isArray(states)) {
    console.error("publishDue: school states unavailable, nothing published", pausedError?.message ?? statesError?.message);
    return 0;
  }
  const pausedIds = [
    ...new Set([...(paused ?? []).map((s) => s.id as string), ...((states ?? []) as { id: string; state: string }[]).filter((s) => s.state !== "active").map((s) => s.id)]),
  ];

  // Work through what is due in small batches until the time is nearly up
  // (B-45: one batch of 5 per run let a backlog delay other schools' posts).
  const started = Date.now();
  let published = 0;
  while (Date.now() - started < budgetMs) {
    // A post Meta was busy for waits for its retry time (release 0.17).
    let query = admin.from("posts").select("id").eq("status", "scheduled").lte("scheduled_at", now).or(`retry_at.is.null,retry_at.lte.${now}`).order("scheduled_at").limit(limit);
    if (pausedIds.length) query = query.not("school_id", "in", `(${pausedIds.join(",")})`);
    const { data: due } = await query;
    if (!due?.length) break;
    let claimed = 0;
    for (const { id } of due) {
      if (Date.now() - started >= budgetMs) break;
      const post = await claim(admin, id, "scheduled");
      if (!post) continue;
      claimed++;
      await publishClaimed(admin, post);
      published++;
    }
    if (!claimed) break;
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
