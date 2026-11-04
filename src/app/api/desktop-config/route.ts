import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

// The desktop app asks the web app where the database is, so its installer
// carries no keys and works with any copy of the app. These two values are
// public by design: the browser receives them too.
export function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ error: "not configured" }, { status: 503 });
  // The newest Mac app, set in Vercel when a version is ready; the app shows
  // "Version x is ready" with the steps (it is not signed by Apple yet).
  const version = process.env.DESKTOP_LATEST_VERSION;
  const url = process.env.DESKTOP_DOWNLOAD_URL;
  const latest = version && url?.startsWith("https://") ? { version, url, notes: process.env.DESKTOP_NOTES ?? "" } : null;
  return NextResponse.json({ app: "school-social-hub", supabaseUrl, supabaseAnonKey, latest });
}
