import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./config";

// The service key skips row level security, so it is only used on the server
// for jobs that have no signed-in user: publishing on schedule, the
// photographer portal and reading Facebook page tokens. The Vercel and
// Supabase integration names it one of these two ways.
const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

export const isAdminConfigured = serviceKey.length > 0 && supabaseUrl.length > 0;

export function createAdminClient() {
  if (!isAdminConfigured) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
