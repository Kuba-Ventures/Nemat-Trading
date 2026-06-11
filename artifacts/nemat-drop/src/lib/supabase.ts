import { createClient } from "@supabase/supabase-js";

// Client-side Supabase client for customer auth (magic-link sign-in).
// detectSessionInUrl lets it pick up the magic-link tokens when the user lands
// back on /account from their email; persistSession keeps them logged in.
const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
