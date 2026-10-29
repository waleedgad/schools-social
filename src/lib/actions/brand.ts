"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { AiLimitError, getAi, type SchoolProfile } from "@/lib/ai";
import { can, defaultCan, isRole, PERMISSION_KEYS, ROLES, type Permission, type PermissionOverrides } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

async function lead(formData: FormData, permission: Permission = "manageCategories") {
  const locale = String(formData.get("locale") ?? "ar");
  const { user, membership } = await requireMembership(locale);
  if (!can(membership.role, permission, membership.school.permissions)) redirect({ href: "/today", locale });
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) =>
    supabase.from("audit_log").insert({ school_id: schoolId, user_id: user.id, action, target, details });
  return { locale, user, membership, schoolId, supabase, audit };
}

const str = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);
const back = (locale: string, tab: string, query: Record<string, string> = {}) => redirect({ href: { pathname: "/categories", query: { tab, ...query } }, locale });

export async function saveCategory(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await lead(formData);
  const id = str(formData, "id", 40);
  const color = str(formData, "color", 7);
  const row = {
    school_id: schoolId,
    name_ar: str(formData, "nameAr", 60) || str(formData, "nameEn", 60),
    name_en: str(formData, "nameEn", 60) || str(formData, "nameAr", 60),
    description: str(formData, "description", 300) || null,
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#3b6cf6",
    hashtags: str(formData, "hashtags", 300) || null,
    frame_id: str(formData, "frame", 40) || null,
    needs_extra_approval: formData.get("extra") === "on",
    language_mode: ["both", "separate", "ar", "en"].includes(str(formData, "languageMode", 10)) ? str(formData, "languageMode", 10) : "both",
  };
  if (!row.name_ar) back(locale, "categories", { error: "name" });
  const { error } = id ? await supabase.from("categories").update(row).eq("id", id) : await supabase.from("categories").insert({ ...row, position: 99 });
  if (error) back(locale, "categories", { error: "save" });
  await audit(id ? "category.updated" : "category.created", row.name_en);
  revalidatePath(`/${locale}/categories`);
  back(locale, "categories", { saved: "1" });
}

export async function deleteCategory(formData: FormData) {
  const { locale, supabase, audit } = await lead(formData);
  const id = str(formData, "id", 40);
  await supabase.from("categories").delete().eq("id", id);
  await audit("category.deleted", id);
  back(locale, "categories");
}

export async function addSlot(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await lead(formData);
  const days = formData.getAll("weekday").map(Number).filter((d) => d >= 0 && d <= 6);
  const time = str(formData, "time", 5);
  if (!days.length || !/^\d{2}:\d{2}$/.test(time)) back(locale, "slots", { error: "slot" });
  const platforms = formData.getAll("platform").map(String).filter((p) => p === "facebook" || p === "instagram");
  await supabase.from("time_slots").insert(
    days.map((weekday) => ({ school_id: schoolId, weekday, at_time: time, category_id: str(formData, "category", 40) || null, platforms: platforms.length ? platforms : ["facebook", "instagram"] })),
  );
  await audit("slots.added", time, { days });
  back(locale, "slots", { saved: "1" });
}

export async function deleteSlot(formData: FormData) {
  const { locale, supabase } = await lead(formData);
  await supabase.from("time_slots").delete().eq("id", str(formData, "id", 40));
  back(locale, "slots");
}

// A suggested week: school days at 6pm, plus Thursday 1pm (end of week).
export async function suggestSlots(formData: FormData) {
  const { locale, schoolId, supabase } = await lead(formData);
  const { data: cats } = await supabase.from("categories").select("id, name_en").eq("school_id", schoolId).order("position");
  const pick = (name: string) => cats?.find((c) => c.name_en === name)?.id ?? null;
  const rows = [
    { weekday: 0, at_time: "18:00", category_id: pick("Achievements") },
    { weekday: 1, at_time: "18:00", category_id: pick("Academics") },
    { weekday: 2, at_time: "18:00", category_id: pick("Events") },
    { weekday: 3, at_time: "18:00", category_id: pick("Student work") },
    { weekday: 4, at_time: "13:00", category_id: pick("Behind the scenes") },
  ].map((r) => ({ ...r, school_id: schoolId }));
  await supabase.from("time_slots").insert(rows);
  back(locale, "slots", { saved: "1" });
}

// The PNG is uploaded from the browser first; this records it.
export async function addFrame(locale: string, name: string, path: string, kind: "frame" | "logo", shape: string) {
  const fd = new FormData();
  fd.set("locale", locale);
  const { schoolId, supabase, audit } = await lead(fd, "writePosts");
  if (!path.startsWith(`${schoolId}/frames/`)) return { ok: false };
  const { error } = await supabase.from("frames").insert({ school_id: schoolId, name: name.slice(0, 60) || "Frame", storage_path: path, kind, shape: ["4:5", "1:1", "9:16", "any"].includes(shape) ? shape : "4:5" });
  if (!error) await audit("frame.added", name);
  revalidatePath(`/${locale}/categories`);
  return { ok: !error };
}

export async function deleteFrame(formData: FormData) {
  const { locale, supabase } = await lead(formData, "writePosts");
  const id = str(formData, "id", 40);
  const { data } = await supabase.from("frames").select("storage_path").eq("id", id).single();
  await supabase.from("frames").delete().eq("id", id);
  if (data) await supabase.storage.from("photos").remove([data.storage_path as string]);
  back(locale, "frames");
}

export async function saveSnippet(formData: FormData) {
  const { locale, schoolId, supabase } = await lead(formData, "writePosts");
  const kind = str(formData, "kind", 20);
  const row = { school_id: schoolId, kind: ["text", "hashtags", "signoff", "avoid"].includes(kind) ? kind : "text", title: str(formData, "title", 60), body: str(formData, "body", 1000) };
  if (!row.title || !row.body) back(locale, "snippets", { error: "snippet" });
  await supabase.from("snippets").insert(row);
  back(locale, "snippets", { saved: "1" });
}

export async function deleteSnippet(formData: FormData) {
  const { locale, supabase } = await lead(formData, "writePosts");
  await supabase.from("snippets").delete().eq("id", str(formData, "id", 40));
  back(locale, "snippets");
}

// Brand page: the school's voice profile, edited by hand or drafted by AI
// from the school's own text (website "About us", a past post or a brochure).
export async function saveProfile(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await lead(formData, "manageCategories");
  const { data: school } = await supabase.from("schools").select("profile").eq("id", schoolId).single();
  const old = (school?.profile ?? {}) as SchoolProfile;
  const profile: SchoolProfile = {
    ...old,
    motto: str(formData, "motto", 200) || undefined,
    stages: str(formData, "stages", 200) || undefined,
    curriculum: str(formData, "curriculum", 200) || undefined,
    audience: str(formData, "audience", 300) || undefined,
    tone: str(formData, "tone", 200) || undefined,
    dialect: formData.get("dialect") === "egyptian" ? "egyptian" : "msa",
    emoji: (["none", "few", "many"].includes(str(formData, "emoji", 10)) ? str(formData, "emoji", 10) : "few") as SchoolProfile["emoji"],
    signoff: str(formData, "signoff", 200) || undefined,
    useWords: str(formData, "useWords", 400) || undefined,
    avoidWords: str(formData, "avoidWords", 400) || undefined,
  };
  if (formData.get("forget") === "1") profile.examples = [];
  await supabase.rpc("set_school_profile", { p_school: schoolId, p_profile: profile });
  await audit("brand.saved", schoolId);
  back(locale, "brand", { saved: "1" });
}

export async function draftProfile(formData: FormData) {
  const { locale, membership, schoolId, supabase } = await lead(formData, "manageCategories");
  const source = str(formData, "source", 6000);
  if (source.length < 40) back(locale, "brand", { error: "source" });
  try {
    const draft = await getAi().buildProfile(membership.school.name, source);
    const { data: school } = await supabase.from("schools").select("profile").eq("id", schoolId).single();
    const { categories, name: _name, ...profile } = draft;
    void _name;
    await supabase.rpc("set_school_profile", { p_school: schoolId, p_profile: { ...((school?.profile ?? {}) as object), ...profile } });
    if (categories?.length) {
      const { data: existing } = await supabase.from("categories").select("name_en").eq("school_id", schoolId);
      const have = new Set((existing ?? []).map((c) => String(c.name_en).toLowerCase()));
      const fresh = categories.filter((c) => !have.has(c.en.toLowerCase())).slice(0, 6);
      if (fresh.length) await supabase.from("categories").insert(fresh.map((c, i) => ({ school_id: schoolId, name_en: c.en.slice(0, 60), name_ar: (c.ar || c.en).slice(0, 60), description: c.description?.slice(0, 300) ?? null, position: 20 + i })));
    }
  } catch (e) {
    back(locale, "brand", { ai: e instanceof AiLimitError ? "limit" : "error" });
  }
  back(locale, "brand", { drafted: "1" });
}

// Approval rules (Roles plan): who approves inside comms, and the optional
// extra approver.
export async function saveApprovals(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await lead(formData, "manageSettings");
  const mode = str(formData, "extraApproval", 20);
  const hours = Number(formData.get("timeoutHours") ?? 0);
  const { error } = await supabase
    .from("schools")
    .update({
      approve_by: formData.get("approveBy") === "any_other" ? "any_other" : "lead",
      lead_self_publish: formData.get("leadSelf") === "on",
      extra_approval: ["off", "all", "categories", "flagged"].includes(mode) ? mode : "off",
      extra_approvers: formData.getAll("extraApprover").map(String).filter(Boolean).slice(0, 5),
      extra_timeout_hours: hours >= 1 && hours <= 168 ? hours : null,
      extra_timeout_action: formData.get("timeoutAction") === "go" ? "go" : "hold",
      photo_limit: Number(formData.get("photoLimit")) > 0 ? Math.min(80, Number(formData.get("photoLimit"))) : null,
    })
    .eq("id", schoolId);
  if (error) redirect({ href: { pathname: "/settings", query: { error: "save", tab: "approvals" } }, locale });
  await audit("settings.approvals", schoolId, { mode });
  redirect({ href: { pathname: "/settings", query: { saved: "1", tab: "approvals" } }, locale });
}

// Ticks and unticks per role; the admin row can't be changed.
export async function savePermissions(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await lead(formData, "manageSettings");
  const out: PermissionOverrides = {};
  for (const role of ROLES) {
    if (role === "admin") continue;
    for (const p of PERMISSION_KEYS) {
      const v = formData.getAll(`${role}.${p}`);
      if (!v.length) continue;
      const on = v.includes("on");
      if (on !== defaultCan(role, p)) (out[role] ??= {})[p] = on;
    }
  }
  if (Object.keys(out).every((r) => isRole(r))) await supabase.from("schools").update({ permissions: out }).eq("id", schoolId);
  await audit("settings.permissions", schoolId);
  revalidatePath(`/${locale}`, "layout");
  redirect({ href: { pathname: "/settings", query: { saved: "1", tab: "roles" } }, locale });
}

// Pause all posting (for example a day of mourning), or one account.
export async function setPause(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await lead(formData, "pauseAccounts");
  const days = Number(formData.get("days") ?? 0);
  const until = days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null;
  await supabase.rpc("set_posting_pause", { p_school: schoolId, p_until: until, p_reason: str(formData, "reason", 200) || null });
  await audit(until ? "posting.paused" : "posting.resumed", schoolId, { days });
  revalidatePath(`/${locale}`, "layout");
  redirect({ href: { pathname: "/accounts", query: { saved: "1" } }, locale });
}

export async function setAccountPaused(formData: FormData) {
  const { locale, schoolId, supabase } = await lead(formData, "pauseAccounts");
  const platform = formData.get("platform") === "instagram" ? "instagram" : "facebook";
  const paused = formData.get("paused") === "1";
  await supabase.rpc("set_account_paused", { p_school: schoolId, p_platform: platform, p_paused: paused });
  redirect({ href: { pathname: "/accounts", query: { saved: "1" } }, locale });
}

export async function setSelfFiling(formData: FormData) {
  const { locale, schoolId, supabase, audit } = await lead(formData, "manageSettings");
  const on = formData.get("on") === "1";
  await supabase.from("schools").update({ self_filing: on }).eq("id", schoolId);
  await audit(on ? "library.self_filing_on" : "library.self_filing_off", schoolId);
  redirect({ href: { pathname: "/settings", query: { saved: "1", tab: "library" } }, locale });
}

export async function saveTermDates(formData: FormData) {
  const { locale, schoolId, supabase } = await lead(formData, "manageSettings");
  const names = formData.getAll("termName").map(String);
  const starts = formData.getAll("termStart").map(String);
  const ends = formData.getAll("termEnd").map(String);
  const terms = names
    .map((name, i) => ({ name: name.trim().slice(0, 40), start: starts[i], end: ends[i] }))
    .filter((t) => t.name && /^\d{4}-\d{2}-\d{2}$/.test(t.start) && /^\d{4}-\d{2}-\d{2}$/.test(t.end));
  await supabase.from("schools").update({ term_dates: terms }).eq("id", schoolId);
  redirect({ href: { pathname: "/settings", query: { saved: "1", tab: "calendar" } }, locale });
}

// Holidays (no posts go out on them, if the school wants) and the weekdays
// the school never posts on. The Mac's calendar uses the same.
export async function saveHolidays(formData: FormData) {
  const { locale, schoolId, supabase } = await lead(formData, "manageSettings");
  const names = formData.getAll("holName").map(String);
  const starts = formData.getAll("holStart").map(String);
  const ends = formData.getAll("holEnd").map(String);
  const holidays = names
    .map((name, i) => ({ name: name.trim().slice(0, 80), start: starts[i], end: /^\d{4}-\d{2}-\d{2}$/.test(ends[i]) ? ends[i] : starts[i] }))
    .filter((t) => t.name && /^\d{4}-\d{2}-\d{2}$/.test(t.start))
    .slice(0, 60);
  const weekdays = formData.getAll("noPostDay").map(Number).filter((n) => n >= 0 && n <= 6);
  await supabase.from("schools").update({ holidays, no_post_days: { weekdays, holidays: formData.get("noPostHolidays") === "on" } }).eq("id", schoolId);
  redirect({ href: { pathname: "/settings", query: { saved: "1", tab: "calendar" } }, locale });
}
