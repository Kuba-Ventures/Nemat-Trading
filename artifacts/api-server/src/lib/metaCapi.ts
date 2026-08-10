import crypto from "node:crypto";

// Meta Conversions API: server-side Purchase event, sent from the Stripe webhook.
//
// Fail-soft: if META_PIXEL_ID or META_CAPI_ACCESS_TOKEN is missing this is a
// no-op, so order recording and the webhook response are never affected. This
// function never throws; network or API errors are logged and swallowed.
//
// All personally identifiable fields are SHA-256 hashed as Meta requires. IP,
// user agent, fbp and fbc are sent unhashed, per the spec. The event_id (the
// Stripe session id) is the dedupe key: if a browser-side Purchase is ever
// added later, give it the same event_id so Meta counts the sale once.

const GRAPH_VERSION = "v21.0";

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
  eventId: string; // Stripe session id, used as the dedupe key
  eventSourceUrl?: string;
  valueCents: number;
  currency: string;
  numItems?: number;
  contentIds?: string[];
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string; // 2-letter code, e.g. "US"
  clientIp?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  eventTimeSec?: number;
};

export async function sendPurchaseEvent(input: PurchaseEventInput): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) return; // fail-soft: Conversions API not configured

  const userData: Record<string, unknown> = {};
  const em = sha256(input.email);
  if (em) userData.em = [em];
  const ph = sha256(digitsOnly(input.phone));
  if (ph) userData.ph = [ph];
  const fn = sha256(input.firstName);
  if (fn) userData.fn = [fn];
  const ln = sha256(input.lastName);
  if (ln) userData.ln = [ln];
  const ct = sha256(input.city?.replace(/\s+/g, ""));
  if (ct) userData.ct = [ct];
  const st = sha256(input.state);
  if (st) userData.st = [st];
  const zp = sha256(input.zip);
  if (zp) userData.zp = [zp];
  const country = sha256(input.country);
  if (country) userData.country = [country];
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;

  const customData: Record<string, unknown> = {
    currency: input.currency.toLowerCase(),
    value: Number((input.valueCents / 100).toFixed(2)),
  };
  if (input.numItems != null) customData.num_items = input.numItems;
  if (input.contentIds && input.contentIds.length > 0) {
    customData.content_ids = input.contentIds;
    customData.content_type = "product";
  }

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: "Purchase",
        event_time: input.eventTimeSec ?? Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: "website",
        ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
        user_data: userData,
        custom_data: customData,
      },
    ],
  };
  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[meta-capi] Purchase send failed (${res.status}):`, text.slice(0, 300));
      return;
    }
    console.log(`[meta-capi] Purchase sent for event_id=${input.eventId}`);
  } catch (err) {
    console.error("[meta-capi] Purchase send error:", err);
  }
}
