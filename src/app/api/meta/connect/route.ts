import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isMetaConfigured, loginUrl } from "@/lib/meta";
import { can } from "@/lib/roles";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "ar";
  const back = new URL(`/${locale}/accounts`, request.url);
  const { membership } = await getSession();
  if (!membership || !can(membership.role, "manageSettings")) return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  if (!isMetaConfigured()) {
    back.searchParams.set("meta", "missing");
    return NextResponse.redirect(back);
  }

  const state = `${locale}.${randomBytes(24).toString("hex")}`;
  const response = NextResponse.redirect(loginUrl(new URL("/api/meta/callback", request.url).toString(), state));
  response.cookies.set("meta_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/meta" });
  return response;
}
