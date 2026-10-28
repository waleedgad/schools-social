import { NextResponse, type NextRequest } from "next/server";
import { MetaError, pagesFromCode } from "@/lib/meta";
import { can } from "@/lib/roles";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const locale = state.startsWith("en.") ? "en" : "ar";
  const back = new URL(`/${locale}/accounts`, request.url);
  const done = (result: string) => {
    back.searchParams.set("meta", result);
    const response = NextResponse.redirect(back);
    response.cookies.delete({ name: "meta_state", path: "/api/meta" });
    return response;
  };

  if (!state || state !== request.cookies.get("meta_state")?.value) return done("error");
  const code = params.get("code");
  if (!code) return done("cancelled");

  const { user, membership } = await getSession();
  if (!user || !membership || !can(membership.role, "manageSettings")) return done("error");

  try {
    const pages = await pagesFromCode(code, new URL("/api/meta/callback", request.url).toString());
    if (!pages.length) return done("nopages");
    const first = pages.find((p) => p.ig_user_id) ?? pages[0];
    const db = createAdminClient();
    await db.from("meta_connections").upsert({
      school_id: membership.school.id,
      page_id: first.id,
      page_name: first.name,
      page_token: first.token,
      ig_user_id: first.ig_user_id,
      ig_username: first.ig_username,
      pages,
      connected_by: user.id,
      connected_at: new Date().toISOString(),
      last_error: null,
    });
    await db.from("audit_log").insert({ school_id: membership.school.id, user_id: user.id, action: "meta.connected", target: first.name });
    return done("connected");
  } catch (e) {
    console.error("meta callback", e instanceof MetaError ? e.message : e);
    return done("error");
  }
}
