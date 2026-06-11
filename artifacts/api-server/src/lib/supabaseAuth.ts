import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Single Supabase client used only to *verify* a caller's access token.
// We use the anon key here — getUser(jwt) validates the token against Supabase
// and returns the authenticated user, which is all we need on the backend.
let cached: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_ANON_KEY must be set to verify account tokens.",
    );
  }
  cached = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * Validate a Bearer token from the Authorization header and return the
 * authenticated user's verified email (lowercased), or null if the token is
 * missing/invalid. The email is verified by Supabase (magic-link sign-in proves
 * ownership), so it's safe to use it to look up that user's orders.
 */
export async function emailFromAuthHeader(
  authHeader: string | undefined,
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const { data, error } = await client().auth.getUser(token);
  if (error || !data.user?.email) return null;
  return data.user.email.trim().toLowerCase();
}
