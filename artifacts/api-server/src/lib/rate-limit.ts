import type { NextFunction, Request, Response } from "express";

/**
 * Small fixed-window, per-client rate limiter for public routes that fan out to
 * upstream sites (TCGPlayer, Scryfall).
 *
 * Limits of this approach (deliberate, to avoid a new dependency or a Redis):
 * - State lives in this process's memory. The API runs as one long-lived Railway
 *   service, so that is one shared counter today. If it is ever scaled to several
 *   replicas, each replica counts separately (the effective limit multiplies by
 *   the replica count). On a serverless target it would be close to useless,
 *   because every cold instance starts with an empty map.
 * - Counters reset on every deploy or restart.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Upper bound on tracked clients so a flood of spoofed keys cannot grow memory without limit. */
  maxKeys?: number;
  now?: () => number;
}

/**
 * The client key for rate limiting.
 *
 * The app sets `trust proxy: true`, which makes `req.ip` the LEFTMOST
 * X-Forwarded-For entry. A client can put anything there, so keying on `req.ip`
 * would let anyone dodge the limit by sending a fresh header per request. The
 * RIGHTMOST entry is the one our own edge proxy (Railway) appended, so use that,
 * and fall back to the socket address when there is no header (local dev, tests).
 */
export function clientKey(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff.join(",") : xff;
  if (raw) {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.socket?.remoteAddress ?? "unknown";
}

export function createRateLimiter(opts: RateLimitOptions) {
  const { windowMs, max } = opts;
  const maxKeys = opts.maxKeys ?? 10_000;
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  function sweep(t: number) {
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const t = now();
    const key = clientKey(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      if (!entry && hits.size >= maxKeys) {
        sweep(t);
        // Still full of live windows: drop the oldest tracked client rather than grow.
        if (hits.size >= maxKeys) {
          const oldest = hits.keys().next().value;
          if (oldest !== undefined) hits.delete(oldest);
        }
      }
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))));
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}
