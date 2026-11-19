import { createClient } from "@supabase/supabase-js";

// Since 0.13 only the owner creates schools; the robot tests sign up and
// create their own schools, so the test database lets people do that
// (owner settings, "self sign-up"). Never touches a real database: the
// tests only run against the local one in e2e/test-db.env.
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/127\.0\.0\.1|localhost/.test(url)) return;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await admin.from("owner_settings").update({ self_signup: true, contact: "WhatsApp +20 100 000 0000" }).eq("id", true);
  if (error) throw new Error(`test database set-up: ${error.message}`);
}
