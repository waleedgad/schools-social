import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaptionLanguages, Captions } from "./ai";
import type { SchoolProfile } from "./ai";
import { ALWAYS_AVOID, avoidList, learnFromPosts, type Learning, type PastPost } from "./captions";

// Reads the school's recent approved and published posts with their results
// and works out what to tell the AI (lib/captions.ts does the thinking).
// Read fresh each time, so there is nothing to keep in step and nothing to
// go stale; a school with no results yet simply gets no hints.
export async function loadLearning(supabase: SupabaseClient, schoolId: string, o: { categoryId?: string | null; languages: CaptionLanguages; except?: string }): Promise<Learning> {
  const { data } = await supabase
    .from("posts")
    .select("id, caption_ar, caption_en, category_id, variations, post_metrics(likes, comments, shares, reach, saves)")
    .eq("school_id", schoolId)
    .in("status", ["approved", "scheduled", "published"])
    .gte("updated_at", new Date(Date.now() - 365 * 86400_000).toISOString())
    .order("updated_at", { ascending: false })
    .limit(150);
  const posts: PastPost[] = (data ?? [])
    .filter((p) => p.id !== o.except)
    .map((p) => ({
      caption_ar: p.caption_ar as string | null,
      caption_en: p.caption_en as string | null,
      category_id: p.category_id as string | null,
      variations: Array.isArray(p.variations) ? (p.variations as Captions[]) : null,
      metrics: (p.post_metrics ?? []) as PastPost["metrics"],
    }));
  return learnFromPosts(posts, o);
}

// Every word the school never wants in AI text: the always-avoided words for
// children, the Brand page's "words to avoid" and the saved banned-word lists.
export async function schoolAvoid(supabase: SupabaseClient, schoolId: string, profile?: SchoolProfile | null): Promise<string[]> {
  const { data } = await supabase.from("snippets").select("body").eq("school_id", schoolId).eq("kind", "avoid");
  return avoidList(ALWAYS_AVOID, profile?.avoidWords, ...(data ?? []).map((x) => x.body as string));
}
