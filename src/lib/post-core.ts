import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiLimitError, getAi, type CaptionOptions, type Captions, type SchoolProfile } from "./ai";
import { notify } from "./alerts";
import { thumbPath } from "./images";
import { isPaused, nextFreeSlot, spread, type Slot } from "./posting";
import { loadPost } from "./posts";
import { checkPost } from "./privacy";
import { publishNow } from "./publish";
import { can } from "./roles";
import type { Membership } from "./session";
import { createAdminClient, isAdminConfigured } from "./supabase/admin";

// The posting rules shared by the website's buttons and the Mac app, so
// both follow the same approvals and privacy checks.

export type PostCtx = { supabase: SupabaseClient; userId: string; membership: Membership };
export type IntentResult = { ok: true; status?: string; id?: string } | { ok: false; error: string };

export const INTENTS = ["save", "idea", "start", "submit", "approve", "reject", "draft", "schedule", "queue", "unschedule", "publish", "delete", "duplicate"] as const;

const NEXT_STATUS: Record<string, string | undefined> = {
  idea: "idea",
  start: "draft",
  submit: "in_review",
  approve: "approved",
  reject: "rejected",
  draft: "draft",
  schedule: "scheduled",
  queue: "scheduled",
  unschedule: "approved",
  publish: "scheduled",
};

export async function schoolSlots(supabase: SupabaseClient, schoolId: string) {
  const [{ data: slots }, { data: taken }] = await Promise.all([
    supabase.from("time_slots").select("id, weekday, at_time, category_id, platforms").eq("school_id", schoolId).returns<Slot[]>(),
    supabase.from("posts").select("scheduled_at").eq("school_id", schoolId).in("status", ["scheduled", "approved", "in_review", "waiting_extra"]).not("scheduled_at", "is", null),
  ]);
  return { slots: slots ?? [], taken: (taken ?? []).map((r) => new Date(r.scheduled_at as string)) };
}

export async function syncPhotos(supabase: SupabaseClient, schoolId: string, postId: string, order: string[]) {
  const { data: rows } = await supabase.from("post_photos").select("photo_id").eq("post_id", postId);
  const keep = new Set(order);
  const gone = (rows ?? []).map((r) => r.photo_id as string).filter((id) => !keep.has(id));
  if (gone.length) await supabase.from("post_photos").delete().eq("post_id", postId).in("photo_id", gone);
  if (order.length) {
    await supabase.from("post_photos").upsert(order.map((photo_id, position) => ({ post_id: postId, photo_id, school_id: schoolId, position })), { onConflict: "post_id,photo_id" });
  }
}

// Runs one button press on a post. `values` are the edited fields (only
// used when the person may write), `order` the photo order when it changed.
export async function runIntent(
  ctx: PostCtx,
  id: string,
  intent: string,
  input: { values?: Record<string, unknown>; order?: string[] | null; reviewNote?: string | null } = {},
): Promise<IntentResult> {
  const { supabase, userId, membership } = ctx;
  const schoolId = membership.school.id;
  const perms = membership.school.permissions;
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) =>
    supabase.from("audit_log").insert({ school_id: schoolId, user_id: userId, action, target, details });

  const loaded = await loadPost(supabase, id);
  if (!loaded) return { ok: false, error: "missing" };
  const { post } = loaded;
  const writer = can(membership.role, "writePosts", perms);
  const locked = ["publishing", "published"].includes(post.status);

  if (intent === "delete") {
    if (locked || !writer) return { ok: false, error: "locked" };
    await supabase.from("posts").delete().eq("id", id);
    await audit("post.deleted", id);
    return { ok: true };
  }

  if (intent === "duplicate") {
    if (!writer) return { ok: false, error: "role" };
    const { data: copy } = await supabase
      .from("posts")
      .insert({
        school_id: schoolId,
        created_by: userId,
        event_id: post.event_id,
        category_id: post.category_id,
        caption_ar: post.caption_ar,
        caption_en: post.caption_en,
        caption_ig: post.caption_ig,
        hashtags: post.hashtags,
        first_comment: post.first_comment,
        platforms: post.platforms,
      })
      .select("id")
      .single();
    if (!copy) return { ok: false, error: "save" };
    const { data: rows } = await supabase.from("post_photos").select("photo_id, position").eq("post_id", id);
    if (rows?.length) await supabase.from("post_photos").insert(rows.map((r) => ({ ...r, post_id: copy.id, school_id: schoolId })));
    await audit("post.duplicated", copy.id, { from: id });
    return { ok: true, id: copy.id as string };
  }

  const values: Record<string, unknown> = locked || !writer ? {} : { ...(input.values ?? {}) };
  if (!locked && writer && input.order) await syncPhotos(supabase, schoolId, id, [...new Set(input.order)]);

  const fresh = (await loadPost(supabase, id))!;
  const merged = { ...fresh.post, ...values };
  const status = NEXT_STATUS[intent];
  if (intent !== "save" && status === undefined) return { ok: false, error: "save" };

  if (["submit", "approve", "schedule", "queue", "publish"].includes(intent)) {
    const checks = await checkPost(supabase, merged, fresh.photos, fresh.post.event?.class_name ?? null);
    if (checks.some((c) => c.level === "block")) {
      if (Object.keys(values).length) await supabase.from("posts").update(values).eq("id", id);
      return { ok: false, error: "checks" };
    }
  }
  const approving = ["approve", "schedule", "queue", "publish"].includes(intent);
  if (approving && post.status === "waiting_extra" && !can(membership.role, "extraApprove", perms)) return { ok: false, error: "signoff" };
  if (approving && post.status !== "waiting_extra" && !can(membership.role, "approvePosts", perms) && !writer) return { ok: false, error: "role" };
  if (intent === "reject" && !can(membership.role, "approvePosts", perms) && !can(membership.role, "extraApprove", perms)) return { ok: false, error: "role" };
  if (intent === "schedule" && !(values.scheduled_at ?? post.scheduled_at)) return { ok: false, error: "when" };

  const update: Record<string, unknown> = { ...values };
  if (status) update.status = status;
  if (intent === "queue") {
    const { slots, taken } = await schoolSlots(supabase, schoolId);
    const at = nextFreeSlot(slots, taken, (merged.category_id as string | null) ?? null, membership.school.timezone) ?? spread(1, [], taken, membership.school.timezone)[0];
    update.scheduled_at = at.toISOString();
  }
  if (intent === "reject") update.review_note = (input.reviewNote ?? "").slice(0, 500) || null;
  if (intent === "submit") update.review_note = null;
  if (intent === "publish") update.scheduled_at = new Date().toISOString();
  if (intent === "draft" || intent === "idea") update.scheduled_at = null;

  if (intent === "publish") {
    const { data: school } = await supabase.from("schools").select("posting_paused_until").eq("id", schoolId).single();
    if (school && isPaused(school)) return { ok: false, error: "paused" };
    if (!isAdminConfigured) return { ok: false, error: "server" };
  }

  if (Object.keys(update).length) {
    const { error } = await supabase.from("posts").update(update).eq("id", id);
    if (error) {
      const hint = (error as { hint?: string }).hint;
      return { ok: false, error: hint === "signoff" ? "signoff" : hint === "comms" ? "comms" : "save" };
    }
  }
  await audit(`post.${intent}`, id, status ? { status } : {});

  if (intent === "reject" && update.review_note) {
    await supabase.from("post_comments").insert({ post_id: id, school_id: schoolId, user_id: userId, author_name: membership.fullName, kind: "review", body: String(update.review_note) });
  }

  // Brand learning: the approved caption becomes an example of the voice.
  if (approving) {
    const final = [merged.caption_ar, merged.caption_en].filter(Boolean).join("\n");
    if (final) await supabase.rpc("learn_caption", { p_school: schoolId, p_text: final });
  }

  if (intent === "publish") {
    const { data: now } = await supabase.from("posts").select("status").eq("id", id).single();
    if (now?.status === "scheduled") await publishNow(createAdminClient(), id);
  }

  const { data: after } = await supabase.from("posts").select("status").eq("id", id).maybeSingle();
  // Someone has to approve: tell them outside the app too (Slack, Teams, email).
  if ((after?.status === "in_review" || after?.status === "waiting_extra") && after.status !== post.status) {
    const text = ((merged.caption_ar || merged.caption_en || "") as string).slice(0, 200);
    await notify(schoolId, "approval", after.status === "waiting_extra" ? `Waiting for your approval · بانتظار موافقتك` : `Post sent for approval · منشور للموافقة`, `${membership.fullName}: ${text}`, `/posts/${id}`);
  }
  return { ok: true, status: (after?.status as string | undefined) ?? status };
}

// The AI writes 1-3 versions; the first one fills the post, the others are
// kept so the writer can switch with one click.
export async function generateFor(ctx: PostCtx, id: string, options: CaptionOptions): Promise<{ ok: true; demo: boolean; versions: Captions[] } | { ok: false; error: string }> {
  const { supabase, membership, userId } = ctx;
  const schoolId = membership.school.id;
  if (!can(membership.role, "writePosts", membership.school.permissions)) return { ok: false, error: "role" };
  const loaded = await loadPost(supabase, id);
  if (!loaded) return { ok: false, error: "missing" };
  const { post, photos } = loaded;
  const { data: school } = await supabase.from("schools").select("brand_voice, hashtags, caption_languages, profile").eq("id", schoolId).single();

  const { data: notes } = photos.length ? await supabase.from("photos").select("note").in("id", photos.map((p) => p.id)).not("note", "is", null) : { data: [] };
  const { data: event } = post.event_id ? await supabase.from("events").select("description").eq("id", post.event_id).maybeSingle() : { data: null };
  const images = (
    await Promise.all(
      photos.slice(0, 4).map(async (p) => {
        const { data } = await supabase.storage.from("photos").download(thumbPath(p.edited_path ?? p.storage_path));
        return data ? new Uint8Array(await data.arrayBuffer()) : null;
      }),
    )
  ).filter((x) => x !== null);

  const ai = getAi();
  let versions: Captions[];
  try {
    versions = await ai.writeCaptions({
      schoolName: membership.school.name,
      brandVoice: school?.brand_voice ?? null,
      profile: (school?.profile ?? {}) as SchoolProfile,
      hashtags: [school?.hashtags, post.category?.hashtags].filter(Boolean).join(" ") || null,
      languages: school?.caption_languages ?? "ar_en",
      eventTitle: post.event?.title ?? null,
      eventDate: post.event?.event_date ?? null,
      className: post.event?.class_name ?? null,
      categoryName: post.category?.name_en ?? null,
      notes: [post.idea, event?.description, ...(notes ?? []).map((n) => n.note as string)].filter(Boolean).slice(0, 12) as string[],
      photos: images,
      options,
    });
  } catch (e) {
    return { ok: false, error: e instanceof AiLimitError ? "limit" : "error" };
  }
  if (!versions.length) return { ok: false, error: "error" };

  const first = versions[0];
  const { error } = await supabase
    .from("posts")
    .update({
      caption_ar: first.ar || null,
      caption_en: first.en || null,
      caption_ig: first.ig || null,
      hashtags: first.hashtags || null,
      variations: versions,
      alt_text: photos.length ? { ar: first.altAr ?? null, en: first.altEn ?? null } : {},
      ...(post.status === "idea" ? { status: "draft" } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "save" };
  await supabase.from("audit_log").insert({ school_id: schoolId, user_id: userId, action: "ai.captions_written", target: id, details: { provider: ai.name, versions: versions.length } });
  return { ok: true, demo: ai.name === "demo", versions };
}
