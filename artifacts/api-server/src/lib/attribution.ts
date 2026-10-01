// Ad attribution carried from the browser into Stripe session metadata and
// then onto the order row, so orders can be matched to Meta ad clicks.
// The client controls these values, so whitelist the keys and cap lengths.
// Nothing here affects price, quantity or payment.

export const ATTRIBUTION_KEYS = [
  "fbclid",
  "fbc",
  "fbp",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "landed_at",
] as const;

export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
export type Attribution = Partial<Record<AttributionKey, string>>;

// Stripe metadata values max out at 500 characters.
const MAX_VALUE_LENGTH = 500;
// Prefix keeps these clear of productId and any future metadata.
const META_PREFIX = "attr_";

export function sanitizeAttribution(input: unknown): Attribution {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const out: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX_VALUE_LENGTH);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

export function attributionToMetadata(a: Attribution): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = a[key];
    if (value) meta[`${META_PREFIX}${key}`] = value;
  }
  return meta;
}

// Order-row columns (camelCase, matching ordersTable) read back from metadata.
export function attributionColumnsFromMetadata(meta: Record<string, string> | null | undefined) {
  const get = (key: AttributionKey) => meta?.[`${META_PREFIX}${key}`] || null;
  return {
    fbclid: get("fbclid"),
    fbc: get("fbc"),
    fbp: get("fbp"),
    utmSource: get("utm_source"),
    utmMedium: get("utm_medium"),
    utmCampaign: get("utm_campaign"),
    utmContent: get("utm_content"),
    utmTerm: get("utm_term"),
    landedAt: get("landed_at"),
  };
}
