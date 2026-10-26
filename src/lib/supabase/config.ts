// Values pasted into a hosting dashboard often pick up spaces, quotes or a
// trailing slash, so clean them before use.
function clean(value: string | undefined) {
  return (value ?? "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const supabaseUrl = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const supabaseAnonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Lets pages show a setup message instead of crashing before the
// Supabase settings are in place.
export const isSupabaseConfigured = isHttpUrl(supabaseUrl) && supabaseAnonKey.length > 0;
