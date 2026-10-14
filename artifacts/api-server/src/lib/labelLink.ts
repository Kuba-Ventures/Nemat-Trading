import { createHmac, timingSafeEqual } from "node:crypto";

// Signed links for the "Buy label" button in the sales@ order email. The token
// is an HMAC of the Checkout Session id, so only someone holding the email can
// open the order's label page, and no login is needed.

function secret(): string | null {
  return process.env.LABEL_LINK_SECRET || process.env.ADMIN_SECRET || null;
}

export function labelToken(sessionId: string): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key).update(`label:${sessionId}`).digest("hex").slice(0, 32);
}

export function verifyLabelToken(sessionId: string, token: unknown): boolean {
  const want = labelToken(sessionId);
  if (!want || typeof token !== "string" || token.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(token));
}

const DEFAULT_API_URL = "https://workspaceapi-server-production-c93f.up.railway.app";

/** The label page for an order, or null if no signing secret is configured. */
export function labelPageUrl(sessionId: string): string | null {
  const t = labelToken(sessionId);
  if (!t) return null;
  const base = (process.env.API_PUBLIC_URL || DEFAULT_API_URL).replace(/\/+$/, "");
  return `${base}/api/labels/${encodeURIComponent(sessionId)}?t=${t}`;
}
