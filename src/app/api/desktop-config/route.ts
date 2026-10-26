import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

// The desktop app asks the web app where the database is, so its installer
// carries no keys and works with any copy of the app. These two values are
// public by design: the browser receives them too.
export function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ error: "not configured" }, { status: 503 });
  return NextResponse.json({ app: "school-social-hub", supabaseUrl, supabaseAnonKey });
}
