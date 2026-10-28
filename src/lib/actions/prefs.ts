"use server";

import { redirect } from "@/i18n/navigation";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Each person picks and orders their own Today sections; the Mac app reads
// the same list.
export async function saveToday(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  const keys = formData.getAll("section").map(String).slice(0, 20);
  const order = (k: string) => Number(formData.get(`order.${k}`) ?? 99);
  const today = [...new Set(keys)].sort((a, b) => order(a) - order(b));
  const supabase = await createClient();
  await supabase.from("user_prefs").upsert({ user_id: user.id, school_id: membership.school.id, today, updated_at: new Date().toISOString() });
  redirect({ href: "/today", locale });
}
