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
  // The Mac's copy of the layout follows: same cards in the same order
  // (under the Mac's names), cards only the Mac has keep their place.
  const MAC = { next: "week", numbers: "results" } as Record<string, string>;
  const { data: prev } = await supabase.from("user_prefs").select("today_layout").eq("user_id", user.id).eq("school_id", membership.school.id).maybeSingle();
  const old = (prev?.today_layout as { key: string; size?: string; hidden?: boolean }[] | null) ?? [];
  const shown = today.map((k) => MAC[k] ?? k);
  const known = new Set(Object.keys(MAC).map((k) => MAC[k]).concat(String(formData.get("known") ?? "").split(",").map((k) => MAC[k] ?? k)));
  const layout = [
    ...shown.map((key) => ({ key, size: old.find((x) => x.key === key)?.size ?? "normal", hidden: false })),
    ...old.filter((x) => !shown.includes(x.key)).map((x) => ({ ...x, hidden: known.has(x.key) ? true : !!x.hidden })),
  ];
  await supabase.from("user_prefs").upsert({ user_id: user.id, school_id: membership.school.id, today, today_layout: layout, updated_at: new Date().toISOString() });
  redirect({ href: "/today", locale });
}
