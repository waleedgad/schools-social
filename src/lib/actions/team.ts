"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { isComms } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { classScope, staffClient } from "@/lib/team";

// Teachers' answers and team reminders. Teachers answer only for their own
// classes; the database functions check that again.

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);

export async function answerFaceCheck(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  await requireMembership(locale);
  const supabase = await createClient();
  const answer = str(formData, "answer", 5);
  await supabase.rpc("answer_face_check", { p_check: str(formData, "id", 60), p_answer: answer === "yes" });
  revalidatePath(`/${locale}/check`);
}

export async function readAlert(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  await requireMembership(locale);
  const supabase = await createClient();
  await supabase.rpc("read_alert", { p_alert: str(formData, "id", 60) });
  revalidatePath(`/${locale}/today`);
}

export async function remindPost(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  const { user, membership } = await requireMembership(locale);
  const supabase = await createClient();
  const id = str(formData, "id", 60);
  const { data: post } = await supabase.from("posts").select("id, caption_ar, caption_en").eq("id", id).eq("school_id", membership.school.id).single();
  if (post) {
    await supabase.from("team_alerts").insert({ school_id: membership.school.id, kind: "remind", created_by: user.id, body: { post: id, from: membership.fullName, text: ((post.caption_ar || post.caption_en || "") as string).slice(0, 120) } });
    await supabase.from("post_comments").insert({ post_id: id, school_id: membership.school.id, user_id: user.id, author_name: membership.fullName, body: locale === "ar" ? "تذكير: هذا المنشور ينتظر الموافقة." : "Reminder: this post is waiting for approval." });
  }
  revalidatePath(`/${locale}/today`);
}

// Ticks on an event's shot list while taking photos.
export async function tickShot(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  await requireMembership(locale);
  const supabase = await createClient();
  const event = str(formData, "event", 60);
  await supabase.rpc("tick_shot", { p_event: event, p_code: str(formData, "code", 40), p_done: str(formData, "done", 5) === "1" });
  revalidatePath(`/${locale}/shots/${event}`);
}

// A teacher checks the names of their class in a yearbook.
export async function checkBookNames(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  const { user, membership } = await requireMembership(locale);
  const supabase = await createClient();
  const book = str(formData, "book", 60);
  const scope = await classScope(supabase, membership.school.id, user.id, membership.role);
  const codes = formData.getAll("code").map(String).slice(0, 400);
  // Only students of the teacher's own classes.
  const { data: allowed } = await staffClient(supabase).from("students").select("student_code, class_name").eq("school_id", membership.school.id).in("student_code", codes.length ? codes : ["-"]);
  const ok = new Set((allowed ?? []).filter((s) => scope.all || scope.classes.includes(s.class_name as string)).map((s) => s.student_code as string));
  const rows = codes
    .filter((c) => ok.has(c))
    .map((code) => {
      const fixed = str(formData, `fix.${code}`, 120);
      return { book_id: book, school_id: membership.school.id, student_code: code, ok: !fixed, fixed_name: fixed || null, note: str(formData, `note.${code}`, 500) || null, checked_by: user.id, checked_at: new Date().toISOString() };
    });
  if (rows.length) await supabase.from("book_checks").upsert(rows);
  redirect({ href: { pathname: `/books/${book}`, query: { saved: "names" } }, locale });
}

export async function commentOnBook(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  const { user, membership } = await requireMembership(locale);
  const supabase = await createClient();
  const book = str(formData, "book", 60);
  const body = str(formData, "body", 1000);
  if (body) await supabase.from("book_comments").insert({ book_id: book, school_id: membership.school.id, page: Number(formData.get("page")) || 1, body, user_id: user.id, author_name: membership.fullName });
  redirect({ href: { pathname: `/books/${book}`, query: { page: String(Number(formData.get("page")) || 1) } }, locale });
}

export async function resolveBookComment(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  await requireMembership(locale);
  const supabase = await createClient();
  const book = str(formData, "book", 60);
  await supabase.from("book_comments").update({ done: true }).eq("id", str(formData, "id", 60));
  revalidatePath(`/${locale}/books/${book}`);
}

// The class teacher's message, the principal's word or a student's quote.
export async function addBookText(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  const { user, membership } = await requireMembership(locale);
  const supabase = await createClient();
  const book = str(formData, "book", 60);
  const kind = ["teacher", "principal", "quote", "other"].includes(str(formData, "kind", 20)) ? str(formData, "kind", 20) : "other";
  const body = str(formData, "body", 1500);
  if (body)
    await supabase.from("book_texts").insert({
      book_id: book, school_id: membership.school.id, kind, body, user_id: user.id, author_name: membership.fullName,
      class_name: str(formData, "class", 60) || null, student_code: str(formData, "student", 40) || null,
    });
  redirect({ href: { pathname: `/books/${book}`, query: { saved: "text" } }, locale });
}

export async function removeBookText(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  await requireMembership(locale);
  const supabase = await createClient();
  await supabase.from("book_texts").delete().eq("id", str(formData, "id", 60));
  revalidatePath(`/${locale}/books/${str(formData, "book", 60)}`);
}

export async function setBookStatus(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  const { membership } = await requireMembership(locale);
  if (!isComms(membership.role)) return;
  const supabase = await createClient();
  const status = ["review", "approved", "printing"].includes(str(formData, "status", 20)) ? str(formData, "status", 20) : "review";
  await supabase.from("books").update({ status }).eq("id", str(formData, "book", 60)).eq("school_id", membership.school.id);
  revalidatePath(`/${locale}/books`);
}

export async function setReportStatus(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  await requireMembership(locale);
  const supabase = await createClient();
  const status = ["open", "seen", "fixed"].includes(str(formData, "status", 10)) ? str(formData, "status", 10) : "seen";
  await supabase.from("problem_reports").update({ status }).eq("id", str(formData, "id", 60));
  revalidatePath(`/${locale}/reports`);
}

export async function sendReport(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  const { user, membership } = await requireMembership(locale);
  const supabase = await createClient();
  const body = str(formData, "body", 4000);
  if (body) await supabase.from("problem_reports").insert({ school_id: membership.school.id, user_id: user.id, body, info: `website ${str(formData, "page", 120)}`.slice(0, 200) });
  redirect({ href: { pathname: "/reports", query: { sent: "1" } }, locale });
}

export async function removeComputer(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  const { membership } = await requireMembership(locale);
  if (membership.role !== "admin") return;
  const supabase = await createClient();
  await supabase.from("computers").delete().eq("id", str(formData, "id", 60)).eq("school_id", membership.school.id);
  revalidatePath(`/${locale}/settings`);
}

// "Fill the gap" on the phone: today's shot list for a class, with the
// students who have the fewest good photos first.
export async function makeShotList(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  const { user, membership } = await requireMembership(locale);
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const cls = str(formData, "class", 60);
  const scope = await classScope(supabase, schoolId, user.id, membership.role);
  if (!cls || (!scope.all && !scope.classes.includes(cls))) redirect({ href: "/coverage", locale });
  const db = staffClient(supabase);
  const [{ data: students }, { data: cov }] = await Promise.all([
    db.from("students").select("student_code, full_name, name_ar").eq("school_id", schoolId).eq("class_name", cls).eq("active", true).not("student_code", "is", null),
    db.from("student_coverage").select("student_code, good, focus").eq("school_id", schoolId).eq("class_name", cls),
  ]);
  const c = new Map((cov ?? []).map((r) => [r.student_code as string, r]));
  const list = (students ?? [])
    .map((s) => ({ code: s.student_code as string, name_en: s.full_name as string, name_ar: (s.name_ar as string | null) ?? null, class_name: cls, good: (c.get(s.student_code as string)?.good as number) ?? 0, focus: (c.get(s.student_code as string)?.focus as number) ?? 0, done: false }))
    .filter((s) => s.good < 3)
    .sort((a, b) => a.good - b.good);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: membership.school.timezone });
  const title = (locale === "ar" ? `صور ${cls}` : `Photos of ${cls}`).slice(0, 120);
  const { data: ev } = await db.from("events").select("id").eq("school_id", schoolId).eq("event_date", today).eq("title", title).maybeSingle();
  let id = ev?.id as string | undefined;
  if (id) await db.from("events").update({ shot_list: list }).eq("id", id);
  else {
    const { data: made } = await db.from("events").insert({ school_id: schoolId, title, event_date: today, class_name: cls, created_by: user.id, shot_list: list }).select("id").single();
    id = made?.id as string | undefined;
  }
  redirect({ href: id ? `/shots/${id}` : { pathname: "/coverage", query: { made: String(list.length) } }, locale });
}
