// Validate a customer's Supabase access token WITHOUT pulling in the full
// supabase-js client. The full client eagerly constructs a Realtime
// (WebSocket) client, which throws on Node < 22 (Railway runs Node 18) where
// there's no native WebSocket. We only need to verify a token, so we call the
// GoTrue /auth/v1/user endpoint directly with native fetch.

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

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_ANON_KEY must be set to verify account tokens.",
    );
  }

  const base = url.replace(/\/+$/, ""); // tolerate a trailing slash
  const res = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const user = (await res.json()) as { email?: string };
  if (!user?.email) return null;
  return user.email.trim().toLowerCase();
}
