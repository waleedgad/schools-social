import { NextResponse, type NextRequest } from "next/server";
import { isProvider, readRosters, tokenFor } from "@/lib/class-lists";
import { can } from "@/lib/roles";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Back from Google or Microsoft: read the classes and add (or update) the
// students by their provider id, so running it again never makes copies.
// The Mac takes the same list from "Download for the Mac".
export async function GET(request: NextRequest) {
  let saved: { state?: string; provider?: string; locale?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get("class_lists")?.value ?? "{}");
  } catch {}
  const locale = saved.locale === "en" ? "en" : "ar";
  const done = (classes: string) => {
    const res = NextResponse.redirect(new URL(`/${locale}/settings?tab=connections&classes=${classes}`, request.url));
    res.cookies.delete({ name: "class_lists", path: "/api/class-lists" });
    return res;
  };
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !saved.state || saved.state !== request.nextUrl.searchParams.get("state") || !isProvider(saved.provider)) return done("denied");
  const { user, membership } = await getSession();
  if (!user || !membership || !can(membership.role, "manageConsent", membership.school.permissions)) return done("denied");
  try {
    const token = await tokenFor(saved.provider, code, new URL("/api/class-lists/callback", request.url).toString());
    const students = await readRosters(saved.provider, token);
    if (!students.length) return done("empty");
    const supabase = await createClient();
    const rows = students.map((s) => ({ school_id: membership.school.id, student_code: s.code, full_name: s.name.trim().slice(0, 120), class_name: s.className }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("students").upsert(rows.slice(i, i + 500), { onConflict: "school_id,student_code" });
      if (error) return done("save");
    }
    await supabase.from("audit_log").insert({ school_id: membership.school.id, user_id: user.id, action: "students.class_lists", target: saved.provider, details: { count: rows.length } });
    return done(String(rows.length));
  } catch {
    return done("failed");
  }
}
