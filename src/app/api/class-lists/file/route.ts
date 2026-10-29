import { NextResponse } from "next/server";
import { can } from "@/lib/roles";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// The students that came from Google Classroom or Teams, as a class list
// file the Mac app reads (Student ID, Name, Class).
export async function GET() {
  const { membership } = await getSession();
  if (!membership || !can(membership.role, "manageConsent", membership.school.permissions)) return new NextResponse("Not allowed", { status: 403 });
  const supabase = await createClient();
  const { data } = await supabase.from("students").select("student_code, full_name, class_name").eq("school_id", membership.school.id).or("student_code.like.gc:%,student_code.like.ms:%").order("class_name").limit(5000);
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["Student ID,Name,Class", ...(data ?? []).map((s) => [s.student_code, s.full_name, s.class_name].map(cell).join(","))];
  return new NextResponse("﻿" + lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="class-lists.csv"' } });
}
