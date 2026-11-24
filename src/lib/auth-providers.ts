import "server-only";
import { pickProviders } from "./integrations";
import { supabaseAnonKey, supabaseUrl } from "./supabase/config";

// Release 0.17: the Google and Microsoft sign-in buttons show by themselves
// once the provider is switched on in Supabase (Authentication > Sign In /
// Providers), so no extra Vercel setting is needed. Supabase's public
// /auth/v1/settings says which providers are on; asked at most every 5 minutes.
export async function supabaseProviders(): Promise<Record<string, boolean>> {
  if (!supabaseUrl || !supabaseAnonKey) return {};
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey }, next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return {};
    return ((await res.json()) as { external?: Record<string, boolean> }).external ?? {};
  } catch {
    return {};
  }
}

export async function signInProviders() {
  return pickProviders(await supabaseProviders(), { google: process.env.AUTH_GOOGLE, microsoft: process.env.AUTH_MICROSOFT });
}
