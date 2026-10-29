import { NextResponse, type NextRequest } from "next/server";
import { can } from "@/lib/roles";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = {
  published_at: string;
  caption_ar: string | null;
  caption_en: string | null;
  category: { name_en: string } | null;
  post_metrics: { platform: string; likes: number; comments: number; shares: number; reach: number; saves: number }[];
};

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The analytics page as a spreadsheet: one row per published post and
// platform in the chosen period.
export async function GET(request: NextRequest) {
  const { membership } = await getSession();
  if (!membership || !can(membership.role, "viewAnalytics", membership.school.permissions)) return new NextResponse("Not allowed", { status: 403 });
  const days = Math.min(400, Math.max(1, Number(request.nextUrl.searchParams.get("days") ?? 30)));
  const supabase = await createClient();
  const { data } = await supabase
    .from("posts")
    .select("published_at, caption_ar, caption_en, category:categories(name_en), post_metrics(platform, likes, comments, shares, reach, saves)")
    .eq("school_id", membership.school.id)
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - days * 86400_000).toISOString())
    .order("published_at")
    .returns<Row[]>();
  const lines = [["date", "platform", "category", "caption", "reach", "likes", "comments", "shares", "saves"].join(",")];
  for (const p of data ?? []) {
    const rows = p.post_metrics.length ? p.post_metrics : [{ platform: "", likes: 0, comments: 0, shares: 0, reach: 0, saves: 0 }];
    for (const m of rows) lines.push([p.published_at.slice(0, 16).replace("T", " "), m.platform, p.category?.name_en ?? "", (p.caption_ar || p.caption_en || "").slice(0, 200), m.reach, m.likes, m.comments, m.shares, m.saves].map(cell).join(","));
  }
  return new NextResponse("﻿" + lines.join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="results-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
