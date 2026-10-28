import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CROPS, type EditSettings } from "./photo-edit";
import { LIMITS } from "./posting";

export type PostPhoto = {
  id: string;
  storage_path: string;
  edited_path: string | null;
  edit_settings: EditSettings | null;
  width: number | null;
  height: number | null;
  contains_opted_out: boolean;
  ai_issues: string[];
  check_status?: string;
  alt_ar?: string | null;
  alt_en?: string | null;
  blur_boxes?: unknown[];
};

// "block" stops approval and publishing; "warn" is shown to the reviewer.
export type Check = { level: "block" | "warn"; key: string; values?: Record<string, string | number> };

function ratio(p: PostPhoto) {
  const crop = p.edit_settings?.crop;
  if (crop && CROPS[crop]) return CROPS[crop];
  return p.width && p.height ? p.width / p.height : 1;
}

function normalise(s: string) {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "") // Arabic diacritics and tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

export async function checkPost(
  supabase: SupabaseClient,
  post: {
    school_id: string;
    caption_ar: string | null;
    caption_en: string | null;
    caption_ig?: string | null;
    hashtags: string | null;
    platforms: string[];
    sensitive: boolean;
    first_comment?: string | null;
  },
  photos: PostPhoto[],
  className: string | null,
): Promise<Check[]> {
  const checks: Check[] = [];

  // Facebook takes text-only posts; Instagram needs at least one photo.
  if (!photos.length && post.platforms.includes("instagram")) checks.push({ level: "block", key: "noPhotos" });
  if (!post.caption_ar?.trim() && !post.caption_en?.trim()) checks.push({ level: "block", key: "noCaption" });
  if (!post.platforms.length) checks.push({ level: "block", key: "noPlatform" });

  const waiting = photos.filter((p) => p.check_status === "waiting").length;
  if (waiting) checks.push({ level: "block", key: "waitingMac", values: { count: waiting } });

  const optedOut = photos.filter((p) => p.contains_opted_out).length;
  if (optedOut) checks.push({ level: "block", key: "optedOut", values: { count: optedOut } });

  const sensitive = photos.filter((p) => p.ai_issues.includes("sensitive")).length;
  if (sensitive && !post.sensitive) checks.push({ level: "block", key: "aiSensitive", values: { count: sensitive } });

  // A student's full name in the caption is a privacy leak.
  const caption = normalise([post.caption_ar, post.caption_en, post.caption_ig, post.hashtags, post.first_comment].join(" "));
  const { data: students } = await supabase
    .from("students")
    .select("full_name, name_ar, class_name, consent_social")
    .eq("school_id", post.school_id)
    .limit(5000);
  const named = (students ?? []).filter((s) =>
    [s.full_name, s.name_ar].some((n) => {
      const name = n ? normalise(n) : "";
      return name.includes(" ") && caption.includes(name);
    }),
  );
  if (named.length) checks.push({ level: "block", key: "studentName", values: { names: named.map((s) => s.full_name).join("، ") } });

  if (className) {
    const inClass = (students ?? []).filter((s) => s.class_name === className && s.consent_social !== "yes").length;
    if (inClass) checks.push({ level: "warn", key: "classConsent", values: { count: inClass, className } });
  }

  if (post.platforms.includes("instagram")) {
    const bad = photos.filter((p) => {
      const r = ratio(p);
      return r < 0.8 - 0.01 || r > 1.91 + 0.01;
    }).length;
    if (bad) checks.push({ level: "block", key: "igRatio", values: { count: bad } });
    if (photos.length > LIMITS.instagram.photos) checks.push({ level: "warn", key: "igLimit", values: { count: LIMITS.instagram.photos } });
    const tags = (post.caption_ig || [post.caption_ar, post.caption_en, post.hashtags].join(" ")).match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
    if (tags > LIMITS.instagram.hashtags) checks.push({ level: "block", key: "igHashtags", values: { count: LIMITS.instagram.hashtags } });
  }

  const issues = photos.filter((p) => p.ai_issues.some((i) => i !== "sensitive")).length;
  if (issues) checks.push({ level: "warn", key: "aiIssues", values: { count: issues } });

  return checks;
}
