import crypto from "node:crypto";

// Meta Conversions API: server-side Purchase, sent from the Stripe webhook.
//
// The browser Purchase (GTM tag on /success, mirrored by the Conversions API
// Gateway) only fires when the pixel loads on /success. Ad blockers and
// app-based payment methods like Cash App Pay can skip that, and then Meta
// never hears about the sale. This sends the same Purchase from the server.
//
// Dedup: event_id is the Stripe session id, the same eventID the GTM tag and
// the Gateway use, so Meta counts each sale once however many copies arrive.
//
// Fail-soft: no-op without META_PIXEL_ID + META_CAPI_ACCESS_TOKEN, and it never
// throws, so it cannot affect the order the webhook just recorded.

const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 5000;

function sha256(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function digitsOnly(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d]/g, "");
  return digits || undefined;
}

export type PurchaseEventInput = {
  eventId: string; // Stripe session id, the dedup key
  eventTimeSec: number;
  eventSourceUrl?: string;
  valueCents: number;
  currency: string;
  numItems?: number;
  contentIds?: string[];
  email?: string;
  phone?: string;
  name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string; // 2-letter code, e.g. "US"
  clientIp?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
};

// Builds the /events request body. PII is SHA-256 hashed per Meta's spec;
// IP, user agent, fbp and fbc are sent as-is, as the spec requires.
export function buildPurchasePayload(input: PurchaseEventInput, testEventCode?: string) {
  const nameTokens = (input.name ?? "").trim().split(/\s+/).filter(Boolean);
  const hashed: Record<string, string | undefined> = {
    em: sha256(input.email),
    ph: sha256(digitsOnly(input.phone)),
    fn: sha256(nameTokens[0]),
    ln: sha256(nameTokens.length > 1 ? nameTokens.slice(1).join(" ") : undefined),
    ct: sha256(input.city?.replace(/\s+/g, "")),
    st: sha256(input.state),
    zp: sha256(input.zip),
    country: sha256(input.country),
    external_id: sha256(input.email),
  };

  const userData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hashed)) {
    if (value) userData[key] = [value];
  }
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;

  const customData: Record<string, unknown> = {
    currency: input.currency.toUpperCase(),
    value: Number((input.valueCents / 100).toFixed(2)),
    order_id: input.eventId,
  };
  if (input.numItems != null) customData.num_items = input.numItems;
  if (input.contentIds && input.contentIds.length > 0) {
    customData.content_ids = input.contentIds;
    customData.content_type = "product";
  }

  return {
    data: [
      {
        event_name: "Purchase",
        event_time: input.eventTimeSec,
        event_id: input.eventId,
        action_source: "website",
        ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
        user_data: userData,
        custom_data: customData,
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

export async function sendPurchaseEvent(input: PurchaseEventInput): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) return;

  const payload = buildPurchasePayload(input, process.env.META_TEST_EVENT_CODE || undefined);
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[meta-capi] Purchase send failed (${res.status}):`, text.slice(0, 300));
      return;
    }
    console.log(`[meta-capi] Purchase sent for ${input.eventId}`);
  } catch (err) {
    console.error("[meta-capi] Purchase send error:", err);
  }
}
