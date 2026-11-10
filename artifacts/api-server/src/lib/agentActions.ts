// What can be changed through the agent key. The key lives only in the Content Hub, which calls these routes when
// Finley taps Approve on a change an agent drafted (the agents never call writes themselves). Pull odds, images and
// everything else stay admin-only. Every change carries `approval` (the board approval) and `reason`, and is logged.

export const AGENT_FIELDS = ["stock", "expiresAt", "active", "title", "shortTitle", "subtitle", "priceCents", "discountPercent"] as const;
export type AgentField = (typeof AGENT_FIELDS)[number];

export type AgentUpdate = {
  updates: Record<string, unknown>;
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
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    if (!(AGENT_FIELDS as readonly string[]).includes(key)) return { error: `${key} can't be changed by agents` };
    if (key === "stock") {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100000) return { error: "stock must be a whole number from 0" };
      updates.stock = value;
    } else if (key === "expiresAt") {
      const at = typeof value === "string" ? new Date(value) : null;
      if (!at || Number.isNaN(at.getTime())) return { error: "expiresAt must be an ISO date" };
      updates.expiresAt = at;
    } else if (key === "priceCents") {
      // products.price is stored in cents (3200 = $32.00).
      if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 10000000) return { error: "priceCents must be a positive whole number of cents" };
      (updates as Record<string, unknown>).price = value;
    } else if (key === "discountPercent") {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 90) return { error: "discountPercent must be a whole number from 0 to 90" };
      updates.discountPercent = value;
    } else if (key === "active") {
      if (typeof value !== "boolean") return { error: "active must be true or false" };
      updates.active = value;
    } else {
      const t = text(value, key === "subtitle" ? 300 : 120);
      if (!t) return { error: `${key} must be non-empty text` };
      updates[key] = t;
    }
  }
  if (!Object.keys(updates).length) return { error: "Nothing to change" };
  return { updates, approval: approvalRef, reason: why };
}

export type RefundRequest = { amountCents: number | null; approval: string; reason: string };

/** A refund for one order: the whole payment (amountCents null) or part of it, with its approval and reason. */
export function parseRefund(body: unknown): RefundRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "Send a JSON body" };
  const { amountCents, approval, reason } = body as Record<string, unknown>;
  const approvalRef = text(approval, 200);
  if (!approvalRef) return { error: "approval (the board approval id) is required" };
  const why = text(reason, 300);
  if (!why) return { error: "reason is required" };
  if (amountCents !== undefined && amountCents !== null && (!Number.isInteger(amountCents) || (amountCents as number) <= 0)) return { error: "amountCents must be a positive whole number of cents, or left out for a full refund" };
  return { amountCents: (amountCents as number) ?? null, approval: approvalRef, reason: why };
}
