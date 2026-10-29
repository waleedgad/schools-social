import { getTranslations, setRequestLocale } from "next-intl/server";
import { Composer, type ComposerData } from "@/components/composer";
import { AppShell } from "@/components/shell";
import { Chip, Notice } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { thumbPath } from "@/lib/images";
import { categoryName, isPaused, photoLimit, STATUS_TONE, type PostStatus } from "@/lib/posting";
import { loadPost, signedThumbs } from "@/lib/posts";
import { checkPost } from "@/lib/privacy";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Captions } from "@/lib/ai/types";

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; ai?: string; saved?: string; done?: string; link?: string; tab?: string; generate?: string; reuse?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { user, membership, workspaces } = await requireMembership(locale);
  const perms = membership.school.permissions;
  if (!can(membership.role, "viewPosts", perms)) redirect({ href: "/today", locale });

  const sp = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const loaded = await loadPost(supabase, id);
  if (!loaded) redirect({ href: "/posts", locale });
  const { post, photos } = loaded!;

  const [checks, { data: meta }, { data: school }, { data: categories }, { data: frames }, { data: snippets }, { data: comments }, { data: versions }, { data: links }, { data: people }] = await Promise.all([
    checkPost(supabase, post, photos, post.event?.class_name ?? null),
    supabase.rpc("meta_status", { p_school: schoolId }),
    supabase.from("schools").select("photo_limit, posting_paused_until, caption_languages, extra_approval, approve_by, lead_self_publish, no_post_days, holidays").eq("id", schoolId).single(),
    supabase.from("categories").select("id, name_ar, name_en, color, hashtags, frame_id, language_mode").eq("school_id", schoolId).order("position"),
    supabase.from("frames").select("id, name, kind, storage_path, shape").eq("school_id", schoolId).order("created_at"),
    supabase.from("snippets").select("id, kind, title, body").eq("school_id", schoolId).neq("kind", "avoid").order("title"),
    supabase.from("post_comments").select("id, author_name, kind, body, created_at, user_id").eq("post_id", id).order("created_at"),
    supabase.from("post_versions").select("id, caption_ar, caption_en, created_at").eq("post_id", id).order("created_at", { ascending: false }).limit(15),
    supabase.from("review_links").select("token, label, answer, comment, answered_at, expires_at").eq("post_id", id).order("created_at", { ascending: false }),
    supabase.from("memberships").select("user_id, full_name, role").eq("school_id", schoolId).eq("active", true),
  ]);

  // Who's in the post (student IDs the Mac sent per photo) and its change history.
  const peopleOf = new Map(photos.map((p) => [p.id, (p as { people?: string[] }).people ?? []]));
  const allCodes = [...new Set([...peopleOf.values()].flat())];
  const [{ data: named }, { data: history }] = await Promise.all([
    allCodes.length ? supabase.from("students").select("student_code, full_name, name_ar").eq("school_id", schoolId).in("student_code", allCodes) : Promise.resolve({ data: [] as { student_code: string; full_name: string; name_ar: string | null }[] }),
    supabase.from("audit_log").select("action, user_id, created_at").eq("school_id", schoolId).eq("target", id).order("created_at", { ascending: false }).limit(40),
  ]);
  const nameOf = new Map((named ?? []).map((n) => [n.student_code as string, locale === "ar" ? (n.name_ar as string | null) || (n.full_name as string) : (n.full_name as string)]));
  const userName = new Map((people ?? []).map((p) => [p.user_id as string, p.full_name as string]));

  // Photos to add: the same event first, then the newest checked ones.
  let extraQuery = supabase
    .from("photos")
    .select("id, storage_path, edited_path, width, height, ai_score")
    .eq("school_id", schoolId)
    .eq("contains_opted_out", false)
    .eq("check_status", "ready")
    .order("created_at", { ascending: false })
    .limit(48);
  if (post.event_id) extraQuery = extraQuery.eq("event_id", post.event_id);
  const { data: more } = await extraQuery;

  const shown = (p: { storage_path: string; edited_path: string | null }) => thumbPath(p.edited_path ?? p.storage_path);
  const thumbs = await signedThumbs(supabase, [...photos.map(shown), ...(more ?? []).map(shown), ...(frames ?? []).map((f) => f.storage_path as string)]);
  const full = await signedThumbs(supabase, photos.map((p) => p.storage_path));

  const m = (meta as { page_id: string | null; page_name: string | null; ig_username: string | null; fb_paused: boolean; ig_paused: boolean }[] | null)?.[0];
  const status = post.status as PostStatus;
  const role = membership.role;
  const author = post.created_by === user.id;

  const data: ComposerData = {
    locale,
    schoolName: membership.school.name,
    pageName: m?.page_name ?? membership.school.name,
    igName: m?.ig_username ?? membership.school.name.replace(/\s+/g, "").toLowerCase(),
    connected: !!m?.page_id,
    accountsPaused: { facebook: !!m?.fb_paused, instagram: !!m?.ig_paused },
    schoolPaused: school ? isPaused(school) : false,
    post: {
      id: post.id,
      status,
      idea: post.idea,
      caption_ar: post.caption_ar ?? "",
      caption_en: post.caption_en ?? "",
      caption_ig: post.caption_ig ?? "",
      hashtags: post.hashtags ?? "",
      first_comment: post.first_comment ?? "",
      location: post.location ?? "",
      platforms: post.platforms,
      sensitive: post.sensitive,
      make_story: post.make_story,
      urgent: post.urgent,
      category_id: post.category_id,
      frame_id: post.frame_id,
      scheduled_at: post.scheduled_at,
      review_note: post.review_note,
      publish_error: post.publish_error,
      published_at: post.published_at,
      fb_post_id: post.fb_post_id,
      ig_media_id: post.ig_media_id,
      alt_ar: (post.alt_text as { ar?: string })?.ar ?? "",
      alt_en: (post.alt_text as { en?: string })?.en ?? "",
      variations: (post.variations ?? []) as Captions[],
    },
    photos: photos.map((p) => ({
      id: p.id,
      thumb: thumbs.get(shown(p)) ?? "",
      full: full.get(p.storage_path) ?? "",
      storagePath: p.storage_path,
      width: p.width,
      height: p.height,
      crop: p.edit_settings?.crop ?? "original",
      waiting: p.check_status === "waiting",
      issues: p.ai_issues,
      settings: p.edit_settings,
    })),
    more: (more ?? []).filter((p) => !photos.some((x) => x.id === p.id)).map((p) => ({ id: p.id as string, thumb: thumbs.get(shown(p as { storage_path: string; edited_path: string | null })) ?? "", score: p.ai_score as number | null })),
    checks: checks.map((c) => ({ level: c.level, text: t(`posts.check.${c.key}`, c.values ?? {}) })),
    categories: (categories ?? []).map((c) => ({ id: c.id as string, name: categoryName(c as { name_ar: string; name_en: string }, locale), color: c.color as string, hashtags: (c.hashtags as string) ?? "", frame_id: c.frame_id as string | null, language_mode: ((c.language_mode as string) ?? "both") as "both" | "separate" | "ar" | "en" })),
    whoIn: { names: allCodes.map((c) => nameOf.get(c) ?? c), named: allCodes.length, photosWithNobody: photos.filter((p) => !(peopleOf.get(p.id) ?? []).length).length, cantAppear: photos.filter((p) => (p as { contains_opted_out?: boolean }).contains_opted_out).length },
    history: (history ?? []).map((h) => ({ action: h.action as string, by: userName.get(h.user_id as string) ?? "", at: h.created_at as string })),
    noPostDays: ((school?.no_post_days as { weekdays?: number[] } | null)?.weekdays ?? []),
    holidays: ((school?.holidays as { name: string; start: string; end: string }[] | null) ?? []),
    frames: (frames ?? []).map((f) => ({ id: f.id as string, name: f.name as string, kind: f.kind as string, url: thumbs.get(f.storage_path as string) ?? "", shape: f.shape as string })),
    snippets: (snippets ?? []).map((s) => ({ id: s.id as string, kind: s.kind as string, title: s.title as string, body: s.body as string })),
    comments: (comments ?? []).map((c) => ({ id: c.id as string, author: (c.author_name as string) ?? "", kind: c.kind as string, body: c.body as string, at: c.created_at as string, mine: c.user_id === user.id })),
    versions: (versions ?? []).map((v) => ({ id: v.id as number, text: (v.caption_ar || v.caption_en || "") as string, at: v.created_at as string })),
    links: (links ?? []).map((l) => ({ token: l.token as string, label: l.label as string, answer: l.answer as string | null, comment: l.comment as string | null, expired: Date.parse(l.expires_at as string) < Date.now() })),
    people: (people ?? []).map((p) => ({ name: p.full_name as string, role: p.role as string })),
    photoLimit: photoLimit(post.platforms, school?.photo_limit ?? null),
    languages: (school?.caption_languages as "ar" | "en" | "ar_en") ?? "ar_en",
    can: {
      write: can(role, "writePosts", perms),
      approve: can(role, "approvePosts", perms) && (school?.approve_by === "any_other" || role === "admin" || role === "comms_lead") && (!author || role === "admin" || !!school?.lead_self_publish),
      approveAny: can(role, "writePosts", perms) && school?.approve_by === "any_other" && !author,
      extra: can(role, "extraApprove", perms),
      urgent: can(role, "urgentPost", perms),
      publish: can(role, "publish", perms),
    },
    openGenerator: sp.generate === "1",
    tab: sp.tab ?? null,
    newLink: sp.link ?? null,
  };

  const notice =
    sp.error ? <Notice>{t(`posts.errors.${sp.error}`)}</Notice>
    : sp.reuse ? <Notice tone={["sent", "planned"].includes(sp.reuse) ? "good" : "danger"}>{t(`more.composer.reuse.result.${["sent", "planned", "instagram", "photos", "role"].includes(sp.reuse) ? sp.reuse : "failed"}`)}</Notice>
    : sp.saved ? <Notice tone="good">{t("posts.saved")}</Notice>
    : sp.done ? <Notice tone="good">{t(`composer.done.${sp.done}`)}</Notice>
    : sp.ai === "done" ? <Notice tone="good">{t("posts.aiDone")}</Notice>
    : sp.ai === "demo" ? <Notice tone="info">{t("posts.aiDemo")}</Notice>
    : sp.ai === "limit" ? <Notice>{t("library.aiLimit", { count: 0 })}</Notice>
    : sp.ai === "error" ? <Notice>{t("library.aiError")}</Notice>
    : null;

  return (
    <AppShell
      locale={locale}
      membership={membership}
      workspaces={workspaces}
      active="posts"
      title={status === "idea" ? t("composer.ideaTitle") : t("posts.editTitle")}
      subtitle={[post.event?.title, post.event?.event_date, post.category ? categoryName(post.category, locale) : null].filter(Boolean).join(" · ")}
      actions={<Chip tone={STATUS_TONE[status]}>{t(`posts.status.${status}`)}</Chip>}
    >
      {notice}
      {status === "rejected" && post.review_note && <Notice tone="warn">{t("posts.changesAsked", { note: post.review_note })}</Notice>}
      {status === "failed" && post.publish_error && <Notice>{t("posts.failedBecause", { error: post.publish_error })}</Notice>}
      <Composer data={data} />
    </AppShell>
  );
}
