"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { requireOwner } from "@/lib/owner";

// The owner page's buttons. Every one goes through a database function
// that checks the caller is an owner and writes the owner log (0019), so a
// school admin calling these gets "not-owner" whatever the website does.

const str = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);
const int = (f: FormData, k: string) => {
  const n = Number.parseInt(String(f.get(k) ?? ""), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};
const money = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").replace(/[,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const day = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};

async function ctx(formData: FormData) {
  const locale = str(formData, "locale", 5) === "en" ? "en" : "ar";
  const { supabase } = await requireOwner(locale);
  return { locale, supabase };
}

function back(locale: string, school: string, query: Record<string, string>): never {
  revalidatePath(`/${locale}/owner`, "layout");
  return redirect({ href: { pathname: `/owner/schools/${school}`, query }, locale });
}

export async function ownerCreateSchool(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const trial = formData.get("trial") === "1";
  const { data, error } = await supabase.rpc("owner_create_school", {
    p_name: str(formData, "name", 120),
    p_plan: str(formData, "plan", 30),
    p_paid_until: trial ? null : day(formData, "paidUntil"),
    p_admin_email: str(formData, "email", 200).toLowerCase(),
    p_locale: formData.get("schoolLocale") === "en" ? "en" : "ar",
  });
  if (error || !data) redirect({ href: { pathname: "/owner/new", query: { error: "1" } }, locale });
  const made = data as { school_id: string; token: string };
  back(locale, made.school_id, { invite: made.token, created: "1" });
}

export async function ownerInviteAdmin(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const school = str(formData, "school", 40);
  const { data, error } = await supabase.rpc("owner_invite_admin", { p_school: school, p_email: str(formData, "email", 200) });
  back(locale, school, error ? { error: "invite" } : { invite: String(data) });
}

export async function ownerSetPlan(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const school = str(formData, "school", 40);
  const { data, error } = await supabase.rpc("owner_set_plan", {
    p_school: school,
    p_plan: str(formData, "plan", 30),
    p_extra_managers: int(formData, "extraManagers"),
    p_extra_computers: int(formData, "extraComputers"),
    p_reason: str(formData, "reason"),
  });
  const r = (data ?? {}) as { error?: string };
  back(locale, school, error ? { error: "save" } : r.error ? { error: r.error } : { saved: "plan" });
}

export async function ownerRecordPayment(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const school = str(formData, "school", 40);
  const amount = money(formData, "amount");
  const covers = day(formData, "coversUntil");
  if (amount === null || !covers) back(locale, school, { error: "payment" });
  const { error } = await supabase.rpc("owner_record_payment", {
    p_school: school,
    p_amount: amount,
    p_currency: str(formData, "currency", 3),
    p_paid_on: day(formData, "paidOn"),
    p_method: ["transfer", "cash", "cheque", "card", "other"].includes(str(formData, "method")) ? str(formData, "method") : "transfer",
    p_covers_until: covers,
    p_note: str(formData, "note"),
  });
  back(locale, school, error ? { error: "payment" } : { saved: "payment" });
}

export async function ownerSetPaidUntil(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const school = str(formData, "school", 40);
  const date = day(formData, "paidUntil");
  const reason = str(formData, "reason");
  if (!date || !reason) back(locale, school, { error: "reason" });
  const { error } = await supabase.rpc("owner_set_paid_until", { p_school: school, p_paid_until: date, p_reason: reason });
  back(locale, school, error ? { error: "save" } : { saved: "date" });
}

export async function ownerForceState(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const school = str(formData, "school", 40);
  const state = str(formData, "state", 20);
  const reason = str(formData, "reason");
  if (!reason) back(locale, school, { error: "reason" });
  const { error } = await supabase.rpc("owner_force_state", {
    p_school: school,
    p_state: ["active", "read_only", "blocked"].includes(state) ? state : null,
    p_reason: reason,
  });
  back(locale, school, error ? { error: "save" } : { saved: "state" });
}

export async function ownerRemoveComputer(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const school = str(formData, "school", 40);
  const { error } = await supabase.rpc("owner_remove_computer", { p_computer: str(formData, "computer", 40), p_reason: str(formData, "reason") });
  back(locale, school, error ? { error: "save" } : { saved: "computer" });
}

export async function ownerSaveNotes(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const school = str(formData, "school", 40);
  const { error } = await supabase.rpc("owner_set_notes", { p_school: school, p_notes: String(formData.get("notes") ?? "").slice(0, 4000) });
  back(locale, school, error ? { error: "save" } : { saved: "notes" });
}

export async function ownerSavePlan(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const id = str(formData, "id", 30).toLowerCase();
  const { data, error } = await supabase.rpc("owner_save_plan", {
    p_id: id,
    p_name_en: str(formData, "nameEn", 40),
    p_name_ar: str(formData, "nameAr", 40),
    p_managers: Math.max(1, int(formData, "managers")),
    p_computers: Math.max(1, int(formData, "computers")),
    p_price: money(formData, "price"),
    p_active: formData.get("active") === "1",
    p_apply_now: formData.get("applyNow") === "1",
  });
  revalidatePath(`/${locale}/owner`, "layout");
  const r = (data ?? {}) as { moved?: number; kept?: number };
  redirect({
    href: { pathname: "/owner/plans", query: error ? { error: "plan" } : { saved: id, moved: String(r.moved ?? 0), kept: String(r.kept ?? 0) } },
    locale,
  });
}

export async function ownerSaveSettings(formData: FormData) {
  const { locale, supabase } = await ctx(formData);
  const { error } = await supabase.rpc("owner_save_settings", {
    p_currency: str(formData, "currency", 3),
    p_extra_manager_price: money(formData, "extraManagerPrice"),
    p_extra_computer_price: money(formData, "extraComputerPrice"),
    p_contact: str(formData, "contact"),
    p_self_signup: formData.get("selfSignup") === "1",
  });
  revalidatePath(`/${locale}/owner`, "layout");
  redirect({ href: { pathname: "/owner/plans", query: error ? { error: "settings" } : { saved: "settings" } }, locale });
}
