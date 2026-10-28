import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAccountNumbers, fetchPostMetrics } from "./meta";

// Results for posts from the last 30 days, at most every 6 hours each, plus
// one followers count per account per day. Small batches keep the free
// plans' limits.
export async function refreshMetrics(admin: SupabaseClient, limit = 10) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: posts } = await admin
    .from("posts")
    .select("id, school_id, fb_post_id, ig_media_id, post_metrics(platform, fetched_at)")
    .eq("status", "published")
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(200);
  const stale = (posts ?? []).filter((p) => {
    const rows = (p.post_metrics ?? []) as { fetched_at: string }[];
    return !rows.length || rows.some((r) => Date.now() - Date.parse(r.fetched_at) > 6 * 3600_000);
  }).slice(0, limit);

  const tokens = new Map<string, { page_token: string; page_id: string; ig_user_id: string | null } | null>();
  const tokenFor = async (school: string) => {
    if (!tokens.has(school)) {
      const { data } = await admin.from("meta_connections").select("page_token, page_id, ig_user_id").eq("school_id", school).maybeSingle();
      tokens.set(school, data?.page_token ? (data as { page_token: string; page_id: string; ig_user_id: string | null }) : null);
    }
    return tokens.get(school);
  };

  for (const p of stale) {
    const meta = await tokenFor(p.school_id as string);
    if (!meta) continue;
    for (const [platform, id] of [["facebook", p.fb_post_id], ["instagram", p.ig_media_id]] as const) {
      if (!id) continue;
      const m = await fetchPostMetrics(platform, id as string, meta.page_token);
      if (m) await admin.from("post_metrics").upsert({ post_id: p.id, school_id: p.school_id, platform, ...m, fetched_at: new Date().toISOString() });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: schools } = await admin.from("meta_connections").select("school_id, page_id, page_token, ig_user_id").not("page_token", "is", null);
  for (const s of schools ?? []) {
    const { count } = await admin.from("account_metrics").select("day", { count: "exact", head: true }).eq("school_id", s.school_id).eq("day", today);
    if (count) continue;
    const n = await fetchAccountNumbers(s.page_id as string, s.ig_user_id as string | null, s.page_token as string);
    const rows = [
      n.facebook !== null && { school_id: s.school_id, platform: "facebook", day: today, followers: n.facebook },
      n.instagram !== null && { school_id: s.school_id, platform: "instagram", day: today, followers: n.instagram },
    ].filter(Boolean);
    if (rows.length) await admin.from("account_metrics").upsert(rows);
  }
}
