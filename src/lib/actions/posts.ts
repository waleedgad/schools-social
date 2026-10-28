"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { AiLimitError, getAi, type CaptionOptions, type Captions, type SchoolProfile, type Tone, TONES } from "@/lib/ai";
import { thumbPath } from "@/lib/images";
import { loadPost } from "@/lib/posts";
import { findMentions, isPaused, nextFreeSlot, spread, type Slot } from "@/lib/posting";
import { checkPost } from "@/lib/privacy";
import { publishNow } from "@/lib/publish";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function curator(formData: FormData | { locale: string }, permission: "writePosts" | "viewPosts" = "writePosts") {
  const locale = formData instanceof FormData ? String(formData.get("locale") ?? "ar") : formData.locale;
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, permission, membership.school.permissions)) redirect({ href: "/today", locale });
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) =>
    supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action, target, details });
  return { locale, user, membership, schoolId, supabase, audit };
}

type Supa = Awaited<ReturnType<typeof createClient>>;

async function schoolSlots(supabase: Supa, schoolId: string) {
  const [{ data: slots }, { data: taken }] = await Promise.all([
    supabase.from("time_slots").select("id, weekday, at_time, category_id, platforms").eq("school_id", schoolId).returns<Slot[]>(),
    supabase.from("posts").select("scheduled_at").eq("school_id", schoolId).in("status", ["scheduled", "approved", "in_review", "waiting_extra"]).not("scheduled_at", "is", null),
  ]);
  return { slots: slots ?? [], taken: (taken ?? []).map((r) => new Date(r.scheduled_at as string)) };
}

// New post from photos, an event, a calendar day, an idea or nothing at all
// (text-only posts are allowed).
export async function createPost(formData: FormData) {
  const { locale, user, schoolId, supabase, audit } = await curator(formData);
  const photoIds = [...new Set(formData.getAll("photo").map(String).filter(Boolean))];
  const event = String(formData.get("event") ?? "") || null;
  const category = String(formData.get("category") ?? "") || null;
  const day = String(formData.get("day") ?? "");
  const idea = String(formData.get("idea") ?? "").trim().slice(0, 1000) || null;
  const asIdea = formData.get("kind") === "idea";
  const back = String(formData.get("back") ?? "/posts");

  let scheduledAt: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) scheduledAt = new Date(`${day}T15:00:00Z`).toISOString();

  // From an event with no photos picked: take its best photos (4-10).
  if (event && !photoIds.length && formData.get("best") === "1") {
    const { data } = await supabase
      .from("photos")
      .select("id")
      .eq("event_id", event)
      .eq("contains_opted_out", false)
      .eq("check_status", "ready")
      .order("is_pick", { ascending: false })
      .order("ai_score", { ascending: false, nullsFirst: false })
      .limit(10);
    photoIds.push(...(data ?? []).map((p) => p.id as string));
  }

  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      school_id: schoolId,
      event_id: event,
      category_id: category,
      created_by: user.id,
      status: asIdea ? "idea" : "draft",
      idea,
      due_on: asIdea && day ? day : null,
      scheduled_at: asIdea ? null : scheduledAt,
    })
    .select("id")
    .single();
  if (error || !post) redirect({ href: { pathname: back, query: { error: "post" } }, locale });

  if (photoIds.length) {
    const { error: photoError } = await supabase
      .from("post_photos")
      .insert(photoIds.map((photo_id, position) => ({ post_id: post!.id, photo_id, school_id: schoolId, position })));
    if (photoError) {
      await supabase.from("posts").delete().eq("id", post!.id);
      redirect({ href: { pathname: back, query: { error: "post" } }, locale });
    }
  }

  await audit(asIdea ? "post.idea" : "post.created", post!.id, { photos: photoIds.length });
  revalidatePath(`/${locale}/posts`);
  if (asIdea) redirect({ href: "/posts", locale });
  redirect({ href: { pathname: `/posts/${post!.id}`, query: formData.get("generate") === "1" ? { generate: "1" } : {} }, locale });
}

function fields(formData: FormData) {
  const platforms = formData.getAll("platform").map(String).filter((p) => p === "facebook" || p === "instagram");
  const when = String(formData.get("scheduledAt") ?? "");
  const text = (k: string, max = 2200) => String(formData.get(k) ?? "").slice(0, max) || null;
  return {
    caption_ar: text("captionAr"),
    caption_en: text("captionEn"),
    caption_ig: formData.get("splitIg") === "on" ? text("captionIg") : null,
    hashtags: text("hashtags", 300),
    first_comment: text("firstComment"),
    location: text("location", 120),
    category_id: text("category", 40),
    platforms,
    sensitive: formData.get("sensitive") === "on",
    make_story: formData.get("story") === "on",
    urgent: formData.get("urgent") === "on",
    frame_id: text("frame", 40),
    idea: text("idea", 1000),
    alt_text: { ar: text("altAr", 400), en: text("altEn", 400) },
    scheduled_at: when && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : null,
  };
}

async function syncPhotos(supabase: Supa, schoolId: string, postId: string, order: string[]) {
  const { data: rows } = await supabase.from("post_photos").select("photo_id").eq("post_id", postId);
  const current = new Set((rows ?? []).map((r) => r.photo_id as string));
  const keep = new Set(order);
  const gone = [...current].filter((id) => !keep.has(id));
  if (gone.length) await supabase.from("post_photos").delete().eq("post_id", postId).in("photo_id", gone);
  await supabase
    .from("post_photos")
    .upsert(order.map((photo_id, position) => ({ post_id: postId, photo_id, school_id: schoolId, position })), { onConflict: "post_id,photo_id" });
}

// One form, many buttons: the button pressed says what to do.
export async function postAction(formData: FormData) {
  const { locale, user, membership, schoolId, supabase, audit } = await curator(formData, "viewPosts");
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "save");
  const perms = membership.school.permissions;
  const back = (query: Record<string, string> = {}) => redirect({ href: { pathname: `/posts/${id}`, query }, locale });

  const loaded = await loadPost(supabase, id);
  if (!loaded) redirect({ href: "/posts", locale });
  const { post } = loaded!;
  const writer = can(membership.role, "writePosts", perms);
  const locked = ["publishing", "published"].includes(post.status);

  if (intent === "delete") {
    if (locked || !writer) back({ error: "locked" });
    await supabase.from("posts").delete().eq("id", id);
    await audit("post.deleted", id);
    revalidatePath(`/${locale}/posts`);
    redirect({ href: "/posts", locale });
  }

  if (intent === "duplicate") {
    if (!writer) back({ error: "role" });
    const { data: copy } = await supabase
      .from("posts")
      .insert({
        school_id: schoolId,
        created_by: user.id,
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
    if (copy) {
      const { data: rows } = await supabase.from("post_photos").select("photo_id, position").eq("post_id", id);
      if (rows?.length) await supabase.from("post_photos").insert(rows.map((r) => ({ ...r, post_id: copy.id, school_id: schoolId })));
      await audit("post.duplicated", copy.id, { from: id });
      redirect({ href: `/posts/${copy.id}`, locale });
    }
    back({ error: "save" });
  }

  // Only writers change the content; approvers only answer.
  const values: Record<string, unknown> = locked || !writer ? {} : fields(formData);
  const order = formData.getAll("order").map(String).filter(Boolean);
  if (!locked && writer && formData.get("photosSent") === "1") await syncPhotos(supabase, schoolId, id, [...new Set(order)]);

  const fresh = (await loadPost(supabase, id))!;
  const merged = { ...fresh.post, ...values };

  const nextStatus: Record<string, string | undefined> = {
    save: undefined,
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
  const status = nextStatus[intent];
  if (intent !== "save" && status === undefined) back({ error: "save" });

  if (["submit", "approve", "schedule", "queue", "publish"].includes(intent)) {
    const checks = await checkPost(supabase, merged, fresh.photos, fresh.post.event?.class_name ?? null);
    if (checks.some((c) => c.level === "block")) {
      if (Object.keys(values).length) await supabase.from("posts").update(values).eq("id", id);
      back({ error: "checks" });
    }
  }
  const approving = ["approve", "schedule", "queue", "publish"].includes(intent);
  if (approving && post.status === "waiting_extra" && !can(membership.role, "extraApprove", perms)) back({ error: "signoff" });
  if (approving && post.status !== "waiting_extra" && !can(membership.role, "approvePosts", perms) && !can(membership.role, "writePosts", perms)) back({ error: "role" });
  if (intent === "reject" && !can(membership.role, "approvePosts", perms) && !can(membership.role, "extraApprove", perms)) back({ error: "role" });
  if (intent === "schedule" && !(values.scheduled_at ?? post.scheduled_at)) back({ error: "when" });

  const update: Record<string, unknown> = { ...values };
  if (status) update.status = status;

  if (intent === "queue") {
    const { slots, taken } = await schoolSlots(supabase, schoolId);
    const at = nextFreeSlot(slots, taken, (merged.category_id as string | null) ?? null, membership.school.timezone) ?? spread(1, [], taken, membership.school.timezone)[0];
    update.scheduled_at = at.toISOString();
  }
  if (intent === "reject") update.review_note = String(formData.get("reviewNote") ?? "").slice(0, 500) || null;
  if (intent === "submit") update.review_note = null;
  if (intent === "publish") update.scheduled_at = new Date().toISOString();
  if (intent === "draft" || intent === "idea") update.scheduled_at = null;

  const { error } = await supabase.from("posts").update(update).eq("id", id);
  if (error) {
    const hint = (error as { hint?: string }).hint;
    back({ error: hint === "signoff" ? "signoff" : hint === "comms" ? "comms" : "save" });
  }
  await audit(`post.${intent}`, id, status ? { status } : {});

  if (intent === "reject" && update.review_note) {
    await supabase.from("post_comments").insert({ post_id: id, school_id: schoolId, user_id: user.id, author_name: membership.fullName, kind: "review", body: String(update.review_note) });
  }

  // Brand learning: the approved caption becomes an example of the voice.
  if (approving) {
    const final = [merged.caption_ar, merged.caption_en].filter(Boolean).join("\n");
    if (final) await supabase.rpc("learn_caption", { p_school: schoolId, p_text: final });
  }

  if (intent === "publish") {
    const { data: school } = await supabase.from("schools").select("posting_paused_until").eq("id", schoolId).single();
    if (school && isPaused(school)) back({ error: "paused" });
    if (!isAdminConfigured) back({ error: "server" });
    const { data: now } = await supabase.from("posts").select("status").eq("id", id).single();
    if (now?.status === "scheduled") await publishNow(createAdminClient(), id);
  }

  revalidatePath(`/${locale}/posts`);
  revalidatePath(`/${locale}/calendar`);
  if (formData.get("return") === "board") redirect({ href: "/posts", locale });
  back(intent === "save" ? { saved: "1" } : { done: intent });
}

// Drag and drop on the board and the calendar.
export async function movePost(locale: string, id: string, to: { status?: string; day?: string }) {
  const { supabase, audit, membership } = await curator({ locale });
  const update: Record<string, unknown> = {};
  if (to.status && ["idea", "draft", "in_review"].includes(to.status)) update.status = to.status;
  if (to.day && /^\d{4}-\d{2}-\d{2}$/.test(to.day)) {
    const { data: post } = await supabase.from("posts").select("scheduled_at").eq("id", id).single();
    const time = post?.scheduled_at ? new Date(post.scheduled_at as string) : null;
    const [y, m, d] = to.day.split("-").map(Number);
    const hh = time ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: membership.school.timezone, hour: "2-digit", hour12: false }).format(time)) % 24 : 18;
    const mm = time ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: membership.school.timezone, minute: "2-digit" }).format(time)) : 0;
    const { zonedTime } = await import("@/lib/posting");
    update.scheduled_at = zonedTime(y, m, d, hh, mm, membership.school.timezone).toISOString();
  }
  if (!Object.keys(update).length) return { ok: false };
  const { error } = await supabase.from("posts").update(update).eq("id", id);
  if (error) return { ok: false, error: error.message };
  await audit("post.moved", id, update);
  revalidatePath(`/${locale}/posts`);
  revalidatePath(`/${locale}/calendar`);
  return { ok: true };
}

// "Spread these over the next days": picks free slots for many posts.
export async function spreadPosts(formData: FormData) {
  const { locale, membership, schoolId, supabase, audit } = await curator(formData);
  const ids = formData.getAll("post").map(String).filter(Boolean);
  if (!ids.length) redirect({ href: "/posts", locale });
  const { slots, taken } = await schoolSlots(supabase, schoolId);
  const times = spread(ids.length, slots, taken, membership.school.timezone);
  await Promise.all(ids.map((id, i) => supabase.from("posts").update({ scheduled_at: times[i].toISOString() }).eq("id", id)));
  await audit("post.spread", ids.join(","), { count: ids.length });
  revalidatePath(`/${locale}/calendar`);
  redirect({ href: { pathname: "/calendar", query: { spread: String(ids.length) } }, locale });
}

async function aiContext(supabase: Supa, schoolId: string) {
  const { data: school } = await supabase
    .from("schools")
    .select("brand_voice, hashtags, caption_languages, profile")
    .eq("id", schoolId)
    .single();
  return { school, profile: (school?.profile ?? {}) as SchoolProfile };
}

function captionOptions(formData: FormData): CaptionOptions {
  const tone = String(formData.get("tone") ?? "");
  const words = Number(formData.get("words") ?? 0);
  return {
    tone: (TONES as readonly string[]).includes(tone) ? (tone as Tone) : null,
    words: words > 0 ? Math.min(400, words) : null,
    emoji: formData.get("emoji") !== "off",
    hashtags: formData.get("withHashtags") !== "off",
    count: Math.min(3, Math.max(1, Number(formData.get("count") ?? 3))),
    prompt: String(formData.get("prompt") ?? "").slice(0, 500) || null,
    splitInstagram: formData.get("splitIg") === "on",
  };
}

// The AI writes 1-3 versions; the first one fills the post, the others are
// kept so the writer can switch with one click.
export async function generateCaptions(formData: FormData) {
  const { locale, membership, schoolId, supabase, audit } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  const back = (query: Record<string, string> = {}) => redirect({ href: { pathname: `/posts/${id}`, query }, locale });
  const loaded = await loadPost(supabase, id);
  if (!loaded) redirect({ href: "/posts", locale });
  const { post, photos } = loaded!;
  const { school, profile } = await aiContext(supabase, schoolId);

  const { data: notes } = photos.length
    ? await supabase.from("photos").select("note").in("id", photos.map((p) => p.id)).not("note", "is", null)
    : { data: [] };
  const { data: event } = post.event_id
    ? await supabase.from("events").select("description").eq("id", post.event_id).maybeSingle()
    : { data: null };
  const images = (
    await Promise.all(
      photos.slice(0, 4).map(async (p) => {
        const { data } = await supabase.storage.from("photos").download(thumbPath(p.edited_path ?? p.storage_path));
        return data ? new Uint8Array(await data.arrayBuffer()) : null;
      }),
    )
  ).filter((x) => x !== null);

  const ai = getAi();
  let versions: Captions[] = [];
  try {
    versions = await ai.writeCaptions({
      schoolName: membership.school.name,
      brandVoice: school?.brand_voice ?? null,
      profile,
      hashtags: [school?.hashtags, post.category?.hashtags].filter(Boolean).join(" ") || null,
      languages: school?.caption_languages ?? "ar_en",
      eventTitle: post.event?.title ?? null,
      eventDate: post.event?.event_date ?? null,
      className: post.event?.class_name ?? null,
      categoryName: post.category?.name_en ?? null,
      notes: [post.idea, event?.description, ...(notes ?? []).map((n) => n.note as string)].filter(Boolean).slice(0, 12) as string[],
      photos: images,
      options: captionOptions(formData),
    });
  } catch (e) {
    back({ ai: e instanceof AiLimitError ? "limit" : "error" });
  }
  if (!versions.length) back({ ai: "error" });

  const first = versions[0];
  const alt = photos.length ? { ar: first.altAr ?? null, en: first.altEn ?? null } : {};
  const { error } = await supabase
    .from("posts")
    .update({
      caption_ar: first.ar || null,
      caption_en: first.en || null,
      caption_ig: first.ig || null,
      hashtags: first.hashtags || null,
      variations: versions,
      alt_text: alt,
      ...(post.status === "idea" ? { status: "draft" } : {}),
    })
    .eq("id", id);
  if (error) back({ error: "save" });
  await audit("ai.captions_written", id, { provider: ai.name, versions: versions.length });
  back({ ai: ai.name === "demo" ? "demo" : "done" });
}

export async function pickVariation(formData: FormData) {
  const { locale, supabase } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  const index = Number(formData.get("index") ?? 0);
  const { data: post } = await supabase.from("posts").select("variations").eq("id", id).single();
  const v = ((post?.variations ?? []) as Captions[])[index];
  if (v) await supabase.from("posts").update({ caption_ar: v.ar || null, caption_en: v.en || null, caption_ig: v.ig || null, hashtags: v.hashtags || null }).eq("id", id);
  redirect({ href: `/posts/${id}`, locale });
}

// Small AI helpers called straight from the editor; they return text and
// change nothing until the writer saves.
export async function aiRewrite(locale: string, text: string, instruction: string, language: "ar" | "en") {
  await curator({ locale });
  try {
    return { text: await getAi().rewrite(text.slice(0, 2200), instruction.slice(0, 300), language) };
  } catch (e) {
    return { error: e instanceof AiLimitError ? "limit" : "error" };
  }
}

export async function aiTranslate(locale: string, text: string, to: "ar" | "en") {
  const { supabase, schoolId } = await curator({ locale });
  const { profile } = await aiContext(supabase, schoolId);
  try {
    return { text: await getAi().translate(text.slice(0, 2200), to, profile) };
  } catch (e) {
    return { error: e instanceof AiLimitError ? "limit" : "error" };
  }
}

export async function aiCheck(locale: string, text: string) {
  const { supabase, schoolId } = await curator({ locale });
  const { profile } = await aiContext(supabase, schoolId);
  const { data: avoid } = await supabase.from("snippets").select("body").eq("school_id", schoolId).eq("kind", "avoid");
  const words = [...(profile.avoidWords ?? "").split(","), ...(avoid ?? []).flatMap((a) => String(a.body).split(","))].map((w) => w.trim()).filter(Boolean);
  try {
    return { check: await getAi().checkCaption(text.slice(0, 4400), profile, words) };
  } catch (e) {
    return { error: e instanceof AiLimitError ? "limit" : "error" };
  }
}

export async function addComment(formData: FormData) {
  const { locale, user, membership, schoolId, supabase } = await curator(formData, "viewPosts");
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (body) {
    const { data: people } = await supabase.from("memberships").select("user_id, full_name").eq("school_id", schoolId).eq("active", true);
    const mentions = findMentions(body, (people ?? []) as { user_id: string; full_name: string }[]);
    await supabase.from("post_comments").insert({ post_id: id, school_id: schoolId, user_id: user.id, author_name: membership.fullName, body, mentions });
  }
  redirect({ href: { pathname: `/posts/${id}`, query: { tab: "comments" } }, locale });
}

export async function createReviewLink(formData: FormData) {
  const { locale, user, schoolId, supabase, audit } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  const label = String(formData.get("label") ?? "").trim().slice(0, 80);
  if (label.length < 2) redirect({ href: { pathname: `/posts/${id}`, query: { error: "label" } }, locale });
  const { data } = await supabase.from("review_links").insert({ post_id: id, school_id: schoolId, label, created_by: user.id }).select("token").single();
  if (data) await audit("post.review_link", id, { label });
  redirect({ href: { pathname: `/posts/${id}`, query: data ? { link: data.token } : { error: "save" } }, locale });
}

export async function restoreVersion(formData: FormData) {
  const { locale, supabase, audit } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  const version = Number(formData.get("version") ?? 0);
  const { data: v } = await supabase.from("post_versions").select("caption_ar, caption_en, caption_ig, hashtags").eq("id", version).eq("post_id", id).single();
  if (v) {
    await supabase.from("posts").update(v).eq("id", id);
    await audit("post.version_restored", id, { version });
  }
  redirect({ href: { pathname: `/posts/${id}`, query: { saved: "1" } }, locale });
}

// "Make a week of posts": the AI plans ideas from upcoming events and the
// school's categories; each becomes an idea card on the board.
export async function makeWeek(formData: FormData) {
  const { locale, user, membership, schoolId, supabase, audit } = await curator(formData);
  const days = Math.min(14, Math.max(3, Number(formData.get("days") ?? 7)));
  const { profile } = await aiContext(supabase, schoolId);
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
  const [{ data: events }, { data: categories }] = await Promise.all([
    supabase.from("events").select("id, title, event_date").eq("school_id", schoolId).gte("event_date", new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)).lte("event_date", until).order("event_date"),
    supabase.from("categories").select("id, name_en").eq("school_id", schoolId).order("position"),
  ]);
  let plan;
  try {
    plan = await getAi().planPosts({
      schoolName: membership.school.name,
      days,
      events: (events ?? []).map((e) => `${e.event_date}: ${e.title}`),
      categories: (categories ?? []).map((c) => c.name_en as string),
      profile,
    });
  } catch (e) {
    redirect({ href: { pathname: "/posts", query: { ai: e instanceof AiLimitError ? "limit" : "error" } }, locale });
  }
  const byName = new Map((categories ?? []).map((c) => [String(c.name_en).toLowerCase(), c.id as string]));
  const rows = plan!.slice(0, 14).map((p) => {
    const due = new Date(Date.parse(today) + p.day * 86400_000).toISOString().slice(0, 10);
    const ev = (events ?? []).find((e) => p.title.toLowerCase().includes(String(e.title).toLowerCase()));
    return {
      school_id: schoolId,
      created_by: user.id,
      status: "idea",
      idea: `${p.title}\n${p.idea}`.slice(0, 1000),
      due_on: due,
      category_id: byName.get(p.category.toLowerCase()) ?? null,
      event_id: ev?.id ?? null,
    };
  });
  if (rows.length) await supabase.from("posts").insert(rows);
  await audit("ai.week_planned", schoolId, { ideas: rows.length });
  revalidatePath(`/${locale}/posts`);
  redirect({ href: { pathname: "/posts", query: { planned: String(rows.length) } }, locale });
}

// Approval link answer (no account needed).
export async function answerReview(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const token = String(formData.get("token") ?? "");
  const answer = formData.get("answer") === "approved" ? "approved" : "changes";
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_review_link", { p_token: token, p_answer: answer, p_comment: String(formData.get("comment") ?? "") });
  redirect({ href: { pathname: `/review/${token}`, query: { answered: error ? "error" : answer } }, locale });
}
