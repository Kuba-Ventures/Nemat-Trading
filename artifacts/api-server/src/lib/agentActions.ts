// What the agents may change on a product, and nothing else. Price, discounts, pull odds, images, orders and refunds
// stay admin-only. Every change carries `approval` (the agents-board approval Finley tapped, checked by the Content
// Hub before it calls here) and `reason`, and is logged.

export const AGENT_FIELDS = ["stock", "expiresAt", "active", "title", "shortTitle", "subtitle"] as const;
export type AgentField = (typeof AGENT_FIELDS)[number];

export type AgentUpdate = {
  updates: Partial<Record<AgentField, unknown>>;
  approval: string;
  reason: string;
};

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

/** Validates an agent's product change. Returns the update or a plain-English error. */
export function parseAgentUpdate(body: unknown): AgentUpdate | { error: string } {
  if (!body || typeof body !== "object") return { error: "Send a JSON body" };
  const { changes, approval, reason } = body as Record<string, unknown>;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return { error: "changes must be an object" };
  const approvalRef = text(approval, 200);
  if (!approvalRef) return { error: "approval (the board approval id) is required" };
  const why = text(reason, 300);
  if (!why) return { error: "reason is required" };
  const updates: Partial<Record<AgentField, unknown>> = {};
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    if (!(AGENT_FIELDS as readonly string[]).includes(key)) return { error: `${key} can't be changed by agents` };
    if (key === "stock") {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100000) return { error: "stock must be a whole number from 0" };
      updates.stock = value;
    } else if (key === "expiresAt") {
      const at = typeof value === "string" ? new Date(value) : null;
      if (!at || Number.isNaN(at.getTime())) return { error: "expiresAt must be an ISO date" };
      updates.expiresAt = at;
    } else if (key === "active") {
      if (typeof value !== "boolean") return { error: "active must be true or false" };
      updates.active = value;
    } else {
      const t = text(value, key === "subtitle" ? 300 : 120);
      if (!t) return { error: `${key} must be non-empty text` };
      updates[key as AgentField] = t;
    }
  }
  if (!Object.keys(updates).length) return { error: "Nothing to change" };
  return { updates, approval: approvalRef, reason: why };
}
