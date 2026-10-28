"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { AiLimitError, getAi } from "@/lib/ai";
import { thumbPath } from "@/lib/images";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Free AI plans allow only a few requests a minute, so photos go in small
// batches and one click checks at most MAX_PHOTOS.
const BATCH = 8;
const MAX_PHOTOS = 40;

export async function checkPhotos(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const event = String(formData.get("event") ?? "none");
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, "viewLibrary")) redirect({ href: "/today", locale });
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const back = (query: Record<string, string>) =>
    redirect({ href: { pathname: "/library", query: { event, sort: "ai", ...query } }, locale });

  let query = supabase
    .from("photos")
    .select("id, storage_path, edited_path, note")
    .eq("school_id", schoolId)
    .is("ai_checked_at", null)
    .order("created_at")
    .limit(MAX_PHOTOS);
  query = event === "none" ? query.is("event_id", null) : query.eq("event_id", event);
  const { data: photos } = await query;

  const { data: ev } =
    event === "none"
      ? { data: null }
      : await supabase.from("events").select("title, class_name").eq("id", event).maybeSingle();
  const context = [ev?.title, ev?.class_name].filter(Boolean).join(", ");

  const ai = getAi();
  let checked = 0;
  try {
    for (let i = 0; i < (photos ?? []).length; i += BATCH) {
      const batch = photos!.slice(i, i + BATCH);
      const inputs = (
        await Promise.all(
          batch.map(async (p) => {
            const { data } = await supabase.storage.from("photos").download(thumbPath(p.edited_path ?? p.storage_path));
            return data ? { id: p.id, jpeg: new Uint8Array(await data.arrayBuffer()) } : null;
          }),
        )
      ).filter((x) => x !== null);
      if (!inputs.length) continue;

      const verdicts = await ai.rankPhotos(inputs, context);
      const now = new Date().toISOString();
      await Promise.all(
        verdicts.map((v) =>
          supabase
            .from("photos")
            .update({ ai_score: v.score, ai_reason: v.reason, ai_issues: v.issues, ai_checked_at: now })
            .eq("id", v.id),
        ),
      );
      checked += verdicts.length;
    }
  } catch (e) {
    await supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action: "ai.failed", target: event, details: { message: String(e).slice(0, 200) } });
    back({ ai: e instanceof AiLimitError ? "limit" : "error", checked: String(checked) });
  }

  await supabase
    .from("audit_log")
    .insert({ school_id: schoolId, user_id: user.id, action: "ai.photos_checked", target: event, details: { count: checked, provider: ai.name } });
  revalidatePath(`/${locale}/library`);
  back({ ai: ai.name === "demo" ? "demo" : "done", checked: String(checked) });
}
