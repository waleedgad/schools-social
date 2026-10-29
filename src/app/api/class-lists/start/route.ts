import { NextResponse, type NextRequest } from "next/server";
import { authUrl, isProvider } from "@/lib/class-lists";
import { can } from "@/lib/roles";
import { getSession } from "@/lib/session";

// Sends the admin to Google or Microsoft to allow reading their classes.
export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider");
  const locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "ar";
  const { membership } = await getSession();
  if (!membership || !can(membership.role, "manageConsent", membership.school.permissions) || !isProvider(provider)) return NextResponse.redirect(new URL(`/${locale}/settings?tab=connections`, request.url));
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(provider, new URL("/api/class-lists/callback", request.url).toString(), state));
  res.cookies.set("class_lists", JSON.stringify({ state, provider, locale }), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/class-lists" });
  return res;
}
