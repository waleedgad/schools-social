"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { AiLimitError, getAi } from "@/lib/ai";
import { thumbPath } from "@/lib/images";
import { loadPost } from "@/lib/posts";
import { checkPost } from "@/lib/privacy";
import { publishNow } from "@/lib/publish";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function curator(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, "writePosts")) redirect({ href: "/dashboard", locale });
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) =>
    supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action, target, details });
  return { locale, user, membership, schoolId, supabase, audit };
}

export async function createPost(formData: FormData) {
  const { locale, user, schoolId, supabase, audit } = await curator(formData);
  const photoIds = formData.getAll("photo").map(String).slice(0, 20);
  const event = String(formData.get("event") ?? "") || null;
  const fail = () => redirect({ href: { pathname: "/library", query: { event: event ?? "none", error: "post" } }, locale });
  if (!photoIds.length) fail();

  const { data: post, error } = await supabase
    .from("posts")
    .insert({ school_id: schoolId, event_id: event, created_by: user.id })
    .select("id")
    .single();
  if (error || !post) return fail();

  const { error: photoError } = await supabase
    .from("post_photos")
    .insert(photoIds.map((photo_id, position) => ({ post_id: post.id, photo_id, school_id: schoolId, position })));
  if (photoError) {
    await supabase.from("posts").delete().eq("id", post.id);
    fail();
  }

  await audit("post.created", post.id, { photos: photoIds.length });
  redirect({ href: `/posts/${post.id}`, locale });
}

function fields(formData: FormData) {
  const platforms = formData.getAll("platform").map(String).filter((p) => p === "facebook" || p === "instagram");
  const when = String(formData.get("scheduledAt") ?? "");
  return {
    caption_ar: String(formData.get("captionAr") ?? "").slice(0, 2200) || null,
    caption_en: String(formData.get("captionEn") ?? "").slice(0, 2200) || null,
    hashtags: String(formData.get("hashtags") ?? "").slice(0, 300) || null,
    platforms,
    sensitive: formData.get("sensitive") === "on",
    scheduled_at: when && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : null,
  };
}

// One form, many buttons: the button pressed says what to do.
export async function postAction(formData: FormData) {
  const { locale, membership, supabase, audit } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "save");
  const back = (query: Record<string, string> = {}) => redirect({ href: { pathname: `/posts/${id}`, query }, locale });

  const loaded = await loadPost(supabase, id);
  if (!loaded) redirect({ href: "/posts", locale });
  const { post, photos } = loaded!;

  if (intent === "delete") {
    if (["publishing", "published"].includes(post.status)) back({ error: "locked" });
    await supabase.from("posts").delete().eq("id", id);
    await audit("post.deleted", id);
    redirect({ href: "/posts", locale });
  }

  const values: Partial<ReturnType<typeof fields>> = ["publishing", "published"].includes(post.status) ? {} : fields(formData);
  const merged = { ...post, ...values };
  const nextStatus: Record<string, string | undefined> = {
    save: undefined,
    submit: "in_review",
    approve: "approved",
    reject: "rejected",
    draft: "draft",
    schedule: "scheduled",
    unschedule: "approved",
    publish: "scheduled",
  };
  const status = nextStatus[intent];

  if (["submit", "approve", "schedule", "publish"].includes(intent)) {
    const checks = await checkPost(supabase, merged, photos, post.event?.class_name ?? null);
    const blocked = checks.find((c) => c.level === "block");
    if (blocked) {
      await supabase.from("posts").update(values).eq("id", id);
      back({ error: "checks" });
    }
  }
  if (intent === "approve" || intent === "schedule" || intent === "publish") {
    if (!can(membership.role, "approvePosts")) back({ error: "role" });
  }
  if (intent === "schedule" && !values.scheduled_at) back({ error: "when" });

  const update: Record<string, unknown> = { ...values };
  if (status) update.status = status;
  if (intent === "reject") update.review_note = String(formData.get("reviewNote") ?? "").slice(0, 500) || null;
  if (intent === "submit") update.review_note = null;
  if (intent === "publish") update.scheduled_at = new Date().toISOString();
  if (intent === "draft") update.scheduled_at = null;

  const { error } = await supabase.from("posts").update(update).eq("id", id);
  if (error) back({ error: error.message.includes("sign-off") ? "signoff" : "save" });
  await audit(`post.${intent}`, id, status ? { status } : {});

  if (intent === "publish") {
    if (!isAdminConfigured) back({ error: "server" });
    await publishNow(createAdminClient(), id);
  }

  revalidatePath(`/${locale}/posts`);
  back(intent === "save" ? { saved: "1" } : {});
}

export async function removePostPhoto(formData: FormData) {
  const { locale, supabase } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  await supabase.from("post_photos").delete().eq("post_id", id).eq("photo_id", String(formData.get("photo") ?? ""));
  revalidatePath(`/${locale}/posts/${id}`);
}

export async function movePostPhoto(formData: FormData) {
  const { locale, supabase } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  const photo = String(formData.get("photo") ?? "");
  const { data: rows } = await supabase.from("post_photos").select("photo_id").eq("post_id", id).order("position");
  const order = (rows ?? []).map((r) => r.photo_id as string);
  const at = order.indexOf(photo);
  if (at > 0) {
    [order[at - 1], order[at]] = [order[at], order[at - 1]];
    await Promise.all(order.map((photo_id, position) => supabase.from("post_photos").update({ position }).eq("post_id", id).eq("photo_id", photo_id)));
  }
  revalidatePath(`/${locale}/posts/${id}`);
}

export async function writeCaptions(formData: FormData) {
  const { locale, membership, schoolId, supabase, audit } = await curator(formData);
  const id = String(formData.get("id") ?? "");
  const back = (query: Record<string, string> = {}) => redirect({ href: { pathname: `/posts/${id}`, query }, locale });
  const loaded = await loadPost(supabase, id);
  if (!loaded) redirect({ href: "/posts", locale });
  const { post, photos } = loaded!;

  const { data: school } = await supabase
    .from("schools")
    .select("brand_voice, hashtags, caption_languages")
    .eq("id", schoolId)
    .single();
  const { data: notes } = await supabase
    .from("photos")
    .select("note")
    .in("id", photos.map((p) => p.id))
    .not("note", "is", null);
  const images = (
    await Promise.all(
      photos.slice(0, 4).map(async (p) => {
        const { data } = await supabase.storage.from("photos").download(thumbPath(p.edited_path ?? p.storage_path));
        return data ? new Uint8Array(await data.arrayBuffer()) : null;
      }),
    )
  ).filter((x) => x !== null);

  const ai = getAi();
  let captions;
  try {
    captions = await ai.writeCaptions({
      schoolName: membership.school.name,
      brandVoice: school?.brand_voice ?? null,
      hashtags: school?.hashtags ?? null,
      languages: school?.caption_languages ?? "ar_en",
      eventTitle: post.event?.title ?? null,
      eventDate: post.event?.event_date ?? null,
      className: post.event?.class_name ?? null,
      notes: [...new Set((notes ?? []).map((n) => n.note as string))].slice(0, 10),
      photos: images,
    });
  } catch (e) {
    back({ ai: e instanceof AiLimitError ? "limit" : "error" });
  }

  const { error } = await supabase
    .from("posts")
    .update({ caption_ar: captions!.ar || null, caption_en: captions!.en || null, hashtags: captions!.hashtags || null })
    .eq("id", id);
  if (error) back({ error: "save" });
  await audit("ai.captions_written", id, { provider: ai.name });
  back({ ai: ai.name === "demo" ? "demo" : "done" });
}
