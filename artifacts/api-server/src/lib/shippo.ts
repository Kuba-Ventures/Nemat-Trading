// Shippo: the parcel used for both checkout quotes and labels, and label purchase
// for paid orders (issue #113). Labels are bought automatically from the Stripe
// webhook, once per new order.

export const SHIPPO_API = "https://api.goshippo.com";

// Packed weight: the first pack in a padded mailer with the thank-you card is
// about 2 oz; each extra pack adds PRODUCT_WEIGHT_OZ. Quotes and labels must use
// the same parcel or the customer pays a different rate than the label costs.
const FIRST_UNIT_OZ = Number(process.env.PACKED_WEIGHT_OZ ?? "2");
const EXTRA_UNIT_OZ = Number(process.env.PRODUCT_WEIGHT_OZ ?? "0.7");

export function parcelFor(quantity: number) {
  const qty = Math.max(1, Math.floor(quantity) || 1);
  const weight = FIRST_UNIT_OZ + EXTRA_UNIT_OZ * (qty - 1);
  return {
    length: "6",
    width: "4",
    height: "1",
    distance_unit: "in" as const,
    weight: weight.toFixed(2),
    mass_unit: "oz" as const,
  };
}

export const ORIGIN_ZIP = process.env.SHIPPING_ORIGIN_ZIP ?? "94303";

// Business return address printed on every label.
export function fromAddress() {
  return {
    name: process.env.SHIP_FROM_NAME ?? "Tommy Top Decker",
    street1: process.env.SHIP_FROM_STREET1 ?? "3294 Ross Road",
    street2: process.env.SHIP_FROM_STREET2 ?? "",
    city: process.env.SHIP_FROM_CITY ?? "Palo Alto",
    state: process.env.SHIP_FROM_STATE ?? "CA",
    zip: ORIGIN_ZIP,
    country: "US",
    ...(process.env.SHIP_FROM_PHONE ? { phone: process.env.SHIP_FROM_PHONE } : {}),
  };
}

export type ShippoRate = {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel: { name: string; token: string };
  estimated_days?: number | null;
};

/**
 * The rate matching what the customer paid for: by Shippo service token (set in
 * checkout metadata), else by the "USPS Ground Advantage" style display name.
 * Falls back to the cheapest USPS rate, flagged so the sales email says so.
 */
export function pickRate(
  rates: ShippoRate[],
  want: { servicelevelToken?: string | null; displayName?: string | null },
): { rate: ShippoRate; fallback: boolean } | null {
  const usps = rates.filter((r) => r.provider === "USPS");
  const byToken = want.servicelevelToken
    ? usps.find((r) => r.servicelevel.token === want.servicelevelToken)
    : undefined;
  if (byToken) return { rate: byToken, fallback: false };
  const byName = want.displayName
    ? usps.find((r) => `${r.provider} ${r.servicelevel.name}` === want.displayName)
    : undefined;
  if (byName) return { rate: byName, fallback: false };
  const cheapest = [...usps].sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0];
  return cheapest ? { rate: cheapest, fallback: true } : null;
}

export type ShipTo = {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
};

export type LabelResult =
  | {
      ok: true;
      transactionId: string;
      trackingNumber: string;
      trackingUrl: string;
      labelUrl: string;
      service: string;
      costCents: number;
      fallback: boolean;
    }
  | { ok: false; reason: string };

async function shippo<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${SHIPPO_API}${path}`, {
    method: "POST",
    headers: { Authorization: `ShippoToken ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shippo ${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** Buys the label. Never throws: a failure comes back as a reason for the sales email. */
export async function buyLabel(opts: {
  sessionId: string;
  quantity: number;
  to: ShipTo;
  servicelevelToken?: string | null;
  displayName?: string | null;
}): Promise<LabelResult> {
  const token = process.env.SHIPPO_API_TOKEN;
  if (!token) return { ok: false, reason: "SHIPPO_API_TOKEN is not set" };
  if (!opts.to.street1 || !opts.to.zip) return { ok: false, reason: "Order has no shipping address" };

  try {
    const shipment = await shippo<{ rates?: ShippoRate[]; messages?: Array<{ text?: string }> }>(
      "/shipments/",
      token,
      {
        address_from: fromAddress(),
        address_to: { ...opts.to, phone: opts.to.phone || undefined, email: opts.to.email || undefined },
        parcels: [parcelFor(opts.quantity)],
        metadata: opts.sessionId,
        async: false,
      },
    );
    const picked = pickRate(shipment.rates ?? [], opts);
    if (!picked) {
      const why = (shipment.messages ?? []).map((m) => m.text).filter(Boolean).join("; ");
      return { ok: false, reason: `No USPS rates for this address${why ? `: ${why}` : ""}` };
    }

    const tx = await shippo<{
      object_id: string;
      status: string;
      tracking_number?: string;
      tracking_url_provider?: string;
      label_url?: string;
      messages?: Array<{ text?: string }>;
    }>("/transactions/", token, {
      rate: picked.rate.object_id,
      label_file_type: process.env.SHIPPO_LABEL_FILE_TYPE ?? "PDF_4x6",
      metadata: opts.sessionId,
      async: false,
    });
    if (tx.status !== "SUCCESS" || !tx.label_url) {
      const why = (tx.messages ?? []).map((m) => m.text).filter(Boolean).join("; ");
      return { ok: false, reason: `Label purchase ${tx.status}${why ? `: ${why}` : ""}` };
    }

    return {
      ok: true,
      transactionId: tx.object_id,
      trackingNumber: tx.tracking_number ?? "",
      trackingUrl: tx.tracking_url_provider ?? "",
      labelUrl: tx.label_url,
      service: `${picked.rate.provider} ${picked.rate.servicelevel.name}`,
      costCents: Math.round(parseFloat(picked.rate.amount) * 100),
      fallback: picked.fallback,
    };
  } catch (err: any) {
    console.error("[shippo] label failed:", err);
    return { ok: false, reason: err?.message ?? "Shippo request failed" };
  }
}
