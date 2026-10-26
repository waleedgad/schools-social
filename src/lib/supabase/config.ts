export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Lets pages show a setup message instead of crashing before the
// Supabase project exists.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
