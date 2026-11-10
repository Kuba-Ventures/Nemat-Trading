import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// The agents' key: a separate, narrow credential for Finley's AI agents (through the Content Hub), never the admin
// secret. It reaches only /api/agent/* routes, which read products and change a short allow-list of fields
// (agentActions.ts). Unset AGENT_KEY = the routes are off (fail closed). Rotate or remove it without touching admin.

const digest = (value: string) => createHash("sha256").update(value).digest();

export function isAgentKey(key: unknown): boolean {
  const want = process.env.AGENT_KEY;
  if (!want || typeof key !== "string" || !key) return false;
  return timingSafeEqual(digest(key), digest(want));
}

export function requireAgentKey(req: Request, res: Response, next: NextFunction): void {
  if (!isAgentKey(req.headers["x-agent-key"])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
