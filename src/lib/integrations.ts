// Every free key the website can use, for Owner > Keys and switches
// (release 0.17). No server-only imports, so the unit tests can use it; the
// page passes in the server's own settings.
//
// A key is added in Vercel (Project > Settings > Environment Variables),
// then the site is redeployed (Deployments > ... > Redeploy) so it is used.

export type KeyItem = {
  key: string;
  // All of these must be set (any one of a group "a|b").
  vars: string[];
  // Optional extras shown under the item.
  optional?: string[];
  // now = needed for testing now; schools = before the first school; later.
  when: "now" | "schools" | "later";
  // Where the key comes from.
  where: string;
  // On without any Vercel key: switched on in Supabase instead.
  supabase?: "google" | "azure";
  // Has a Test button on the page.
  test?: "gemini" | "meta";
};

export const KEYS: KeyItem[] = [
  { key: "database", vars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY"], when: "now", where: "https://supabase.com/dashboard/project/_/settings/api-keys" },
  { key: "site", vars: ["NEXT_PUBLIC_SITE_URL"], when: "now", where: "https://vercel.com/dashboard" },
  { key: "scheduler", vars: ["CRON_SECRET"], when: "now", where: "https://vercel.com/dashboard" },
  { key: "gemini", vars: ["GEMINI_API_KEY"], optional: ["GEMINI_MODEL", "GEMINI_FALLBACK_MODEL"], when: "now", where: "https://aistudio.google.com/apikey", test: "gemini" },
  { key: "meta", vars: ["META_APP_ID", "META_APP_SECRET"], optional: ["META_CONFIG_ID", "META_GRAPH_VERSION"], when: "now", where: "https://developers.facebook.com/apps/", test: "meta" },
  { key: "googleSignIn", vars: [], when: "schools", where: "https://supabase.com/dashboard/project/_/auth/providers", supabase: "google" },
  { key: "microsoftSignIn", vars: [], when: "schools", where: "https://supabase.com/dashboard/project/_/auth/providers", supabase: "azure" },
  { key: "dropbox", vars: ["NEXT_PUBLIC_DROPBOX_APP_KEY"], when: "schools", where: "https://www.dropbox.com/developers/apps" },
  { key: "googleDrive", vars: ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY"], optional: ["NEXT_PUBLIC_GOOGLE_APP_ID"], when: "schools", where: "https://console.cloud.google.com/apis/credentials" },
  { key: "oneDrive", vars: ["NEXT_PUBLIC_MICROSOFT_CLIENT_ID"], when: "schools", where: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
  { key: "classroom", vars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], when: "schools", where: "https://console.cloud.google.com/apis/credentials" },
  { key: "teams", vars: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], when: "schools", where: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
  { key: "support", vars: ["SUPPORT_WHATSAPP|NEXT_PUBLIC_SUPPORT_WHATSAPP"], optional: ["SUPPORT_EMAIL"], when: "schools", where: "https://vercel.com/dashboard" },
  // Waits for Later L-40 (Waleed, 24 Nov: "skip the email").
  { key: "email", vars: ["RESEND_API_KEY"], optional: ["ALERT_FROM"], when: "later", where: "https://resend.com/api-keys" },
  // After Meta's business verification.
  { key: "whatsapp", vars: ["WHATSAPP_TOKEN", "WHATSAPP_VERIFY_TOKEN"], when: "later", where: "https://business.facebook.com/settings/whatsapp-business-accounts" },
];

export type KeyStatus = KeyItem & { on: boolean; missing: string[]; optionalSet: string[] };

const isSet = (env: Record<string, string | undefined>, name: string) => name.split("|").some((n) => (env[n] ?? "").trim().length > 0);

export function keyStatus(env: Record<string, string | undefined>, external: Record<string, boolean>): KeyStatus[] {
  return KEYS.map((k) => {
    const missing = k.vars.filter((v) => !isSet(env, v));
    const on = k.supabase ? pickProviders(external, { google: env.AUTH_GOOGLE, microsoft: env.AUTH_MICROSOFT }).includes(k.supabase) : missing.length === 0;
    return { ...k, on, missing, optionalSet: (k.optional ?? []).filter((v) => isSet(env, v)) };
  });
}

// Google / Microsoft sign-in buttons: on when switched on in Supabase, or
// forced with AUTH_GOOGLE / AUTH_MICROSOFT = "on"; "off" hides them.
export type SignInProvider = "google" | "azure";
export function pickProviders(external: Record<string, boolean>, env: { google?: string; microsoft?: string }): SignInProvider[] {
  const on = (flag: string | undefined, fromSupabase: boolean | undefined) => (flag === "off" ? false : flag === "on" || !!fromSupabase);
  return [on(env.google, external.google) && "google", on(env.microsoft, external.azure) && "azure"].filter(Boolean) as SignInProvider[];
}
