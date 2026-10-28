"use server";

import { redirect } from "@/i18n/navigation";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// "Report a problem": kept in the activity log with the page it came from,
// so the owner sees it with the school's other events.
export async function reportProblem(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (body) {
    const supabase = await createClient();
    await supabase.from("audit_log").insert({
      school_id: membership.school.id,
      user_id: user.id,
      action: "support.reported",
      target: String(formData.get("page") ?? "").slice(0, 200),
      details: { body, kind: String(formData.get("kind") ?? "problem").slice(0, 20) },
    });
  }
  redirect({ href: { pathname: "/help", query: { reported: "1" } }, locale });
}
