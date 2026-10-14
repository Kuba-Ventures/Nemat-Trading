import type Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { buyLabel, type LabelResult, type ShipTo } from "./shippo";
import { buildShippingPdf, fetchLabelPdf, type SlipInput } from "./packingSlip";
import { sendTrackingEmail } from "./orderEmail";

// Click-to-buy labels (issue #113, revised 2026-10-13): the sales@ email carries
// a "Buy label" link; one click buys the label, emails the customer tracking and
// opens a printable label + packing slip PDF. Nothing is bought automatically.
//
// The session must be retrieved with expand: ["line_items", "shipping_cost.shipping_rate"].

export type LabelOrder = {
  sessionId: string;
  item: string;
  quantity: number;
  created: Date;
  to: ShipTo;
  servicelevelToken: string | null;
  displayName: string | null;
};

export function labelOrderFromSession(full: Stripe.Checkout.Session): LabelOrder {
  const lineItems = full.line_items?.data ?? [];
  const addr = full.shipping_details?.address;
  const rate = full.shipping_cost?.shipping_rate;
  return {
    sessionId: full.id,
    item: lineItems.map((li) => li.description).filter(Boolean).join(", ") || "Unknown item",
    quantity: lineItems.reduce((n, li) => n + (li.quantity ?? 0), 0) || 1,
    created: new Date(full.created * 1000),
    to: {
      name: full.shipping_details?.name || full.customer_details?.name || "",
      street1: addr?.line1 ?? "",
      street2: addr?.line2 ?? "",
      city: addr?.city ?? "",
      state: addr?.state ?? "",
      zip: addr?.postal_code ?? "",
      country: addr?.country || "US",
      phone: full.customer_details?.phone ?? "",
      email: full.customer_details?.email ?? "",
    },
    servicelevelToken: full.metadata?.shippoService ?? null,
    displayName: rate && typeof rate === "object" ? rate.display_name : null,
  };
}

export function slipFor(o: LabelOrder, label?: { trackingNumber: string; service: string }): SlipInput {
  const locality = [o.to.city, o.to.state].filter(Boolean).join(", ");
  return {
    orderId: o.sessionId,
    date: o.created,
    item: o.item,
    quantity: o.quantity,
    shipTo: [o.to.name, o.to.street1, o.to.street2, [locality, o.to.zip].filter(Boolean).join(" ")].filter(Boolean),
    ...(label ?? {}),
  };
}

export type SavedLabel = {
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string;
  service: string;
  costCents: number;
};

const PENDING = "pending";

/** The label already bought for this order, if any. */
export async function savedLabel(sessionId: string): Promise<SavedLabel | "pending" | null> {
  const [row] = await db
    .select({
      tx: ordersTable.shippoTransactionId,
      trackingNumber: ordersTable.trackingNumber,
      trackingUrl: ordersTable.trackingUrl,
      labelUrl: ordersTable.labelUrl,
      shippingMethod: ordersTable.shippingMethod,
      costCents: ordersTable.labelCostCents,
    })
    .from(ordersTable)
    .where(eq(ordersTable.stripeSessionId, sessionId));
  if (!row?.tx) return null;
  if (row.tx === PENDING || !row.labelUrl) return "pending";
  return {
    trackingNumber: row.trackingNumber ?? "",
    trackingUrl: row.trackingUrl ?? "",
    labelUrl: row.labelUrl,
    service: row.shippingMethod ?? "USPS",
    costCents: row.costCents ?? 0,
  };
}

/**
 * Buys the label once. The order row is claimed first, so a double click or a
 * second tab can never buy two labels. On failure the claim is released.
 */
export async function buyLabelOnce(
  o: LabelOrder,
): Promise<LabelResult | { ok: false; reason: string; already: true }> {
  const claimed = await db
    .update(ordersTable)
    .set({ shippoTransactionId: PENDING })
    .where(and(eq(ordersTable.stripeSessionId, o.sessionId), isNull(ordersTable.shippoTransactionId)))
    .returning({ id: ordersTable.id });
  if (claimed.length === 0) {
    return { ok: false, reason: "A label was already bought (or is being bought) for this order", already: true };
  }

  const label = await buyLabel({
    sessionId: o.sessionId,
    quantity: o.quantity,
    to: o.to,
    servicelevelToken: o.servicelevelToken,
    displayName: o.displayName,
  });

  if (!label.ok) {
    await db
      .update(ordersTable)
      .set({ shippoTransactionId: null })
      .where(eq(ordersTable.stripeSessionId, o.sessionId))
      .catch((err) => console.error("[label] releasing claim failed:", err));
    return label;
  }

  try {
    await db
      .update(ordersTable)
      .set({
        shippoTransactionId: label.transactionId,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl || null,
        labelUrl: label.labelUrl,
        labelCostCents: label.costCents,
      })
      .where(eq(ordersTable.stripeSessionId, o.sessionId));
  } catch (err) {
    // The label is bought; say so loudly so it isn't bought again by hand.
    console.error(`[label] BOUGHT ${label.transactionId} for ${o.sessionId} but saving failed:`, err);
  }

  await sendTrackingEmail({ sessionId: o.sessionId, customerEmail: o.to.email }, label);
  return label;
}

/** Label page(s) then the packing slip, ready to print. */
export async function printablePdf(o: LabelOrder, label: SavedLabel | null): Promise<Uint8Array | null> {
  return buildShippingPdf(
    slipFor(o, label ? { trackingNumber: label.trackingNumber, service: label.service } : undefined),
    label ? await fetchLabelPdf(label.labelUrl) : null,
  );
}
