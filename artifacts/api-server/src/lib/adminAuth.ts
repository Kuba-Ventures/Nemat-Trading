import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Admin auth. The admin page logs in with a password that only the server knows
// (ADMIN_PASSWORD) and gets back a short-lived token signed with ADMIN_SECRET.
// Every admin route checks that token in the `x-admin-key` header. Nothing
// secret ships in the storefront bundle.
//
// Token: base64url(JSON {exp}) + "." + base64url(HMAC-SHA256(payload, ADMIN_SECRET)).
// Stateless, so rotating ADMIN_SECRET signs everyone out.

export const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A signed admin token, or null when ADMIN_SECRET is unset (fail closed). */
export function signAdminToken(now = Date.now()): { token: string; expiresAt: number } | null {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return null;
  const expiresAt = now + ADMIN_TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString("base64url");
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

export function verifyAdminToken(token: unknown, now = Date.now()): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || typeof token !== "string") return false;
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) return false;
  if (!safeEqual(mac, sign(payload, secret))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

/**
 * True for a valid token. While ADMIN_ACCEPT_LEGACY_KEY=1, the raw ADMIN_SECRET
 * is also accepted, so old clients keep working during a rollout. Off by default.
 */
export function isAdminKey(key: unknown): boolean {
  if (verifyAdminToken(key)) return true;
  const secret = process.env.ADMIN_SECRET;
  return (
    process.env.ADMIN_ACCEPT_LEGACY_KEY === "1" &&
    !!secret &&
    typeof key === "string" &&
    safeEqual(key, secret)
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminKey(req.headers["x-admin-key"])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** Timing-safe password check against ADMIN_PASSWORD; false when it's unset. */
export function checkAdminPassword(password: unknown): boolean {
  const want = process.env.ADMIN_PASSWORD;
  if (!want || typeof password !== "string") return false;
  return safeEqual(
    createHmac("sha256", "admin-password").update(password).digest("hex"),
    createHmac("sha256", "admin-password").update(want).digest("hex"),
  );
}
