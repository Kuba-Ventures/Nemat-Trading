import type Stripe from "stripe";
import { attributionColumnsFromMetadata } from "./attribution";
import { isInternalEmail } from "./metrics";

/** Fully refunded, from a session listed with expand: ["data.payment_intent.latest_charge"]. */
export function isFullyRefunded(session: Stripe.Checkout.Session): boolean {
  const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const total = session.amount_total ?? 0;
  return !!charge && total > 0 && charge.amount_refunded >= total;
}

/**
 * Backfill imports live orders only: it skips team test orders (qsbsrollover
 * addresses) and fully refunded ones we haven't already kept, so ones deleted
 * from the admin Orders list stay deleted. Kept ones still update.
 */
export function skipBackfillSession(session: Stripe.Checkout.Session, existing: Set<string>): boolean {
  if (existing.has(session.id)) return false;
  return isInternalEmail(session.customer_details?.email) || isFullyRefunded(session);
}

// Build the orders-table row from an (expanded) Stripe Checkout Session.
// Shared by the live webhook and the admin backfill so both stay identical.
// The session must be retrieved with:
//   expand: ["line_items", "shipping_cost.shipping_rate", "total_details.breakdown"]
export function orderRowFromSession(full: Stripe.Checkout.Session) {
  const lineItems = full.line_items?.data ?? [];
  const quantity = lineItems[0]?.quantity ?? 1;
  const subtotalCents = lineItems.reduce((n, li) => n + (li.amount_subtotal ?? 0), 0);
  const shippingCents = full.shipping_cost?.amount_total ?? 0;
  const taxCents = full.total_details?.amount_tax ?? 0;
  const totalCents = full.amount_total ?? 0;
  const customerEmail = full.customer_details?.email ?? "";
  const customerName = full.customer_details?.name ?? "";

  const addr = full.shipping_details?.address;
  const formattedAddress = addr
    ? [addr.line1, addr.line2, `${addr.city}, ${addr.state} ${addr.postal_code}`]
        .filter(Boolean)
        .join(", ")
    : "";

  const shippingRate = full.shipping_cost?.shipping_rate;
  const shippingMethod =
    shippingRate && typeof shippingRate === "object" ? shippingRate.display_name ?? "" : "";

  const productIdMeta = full.metadata?.productId;
  const productId = productIdMeta ? Number(productIdMeta) || null : null;

  return {
    stripeSessionId: full.id,
    customerEmail,
    customerName: customerName || null,
    productId,
    quantity,
    subtotalCents,
    shippingCents,
    shippingMethod: shippingMethod || null,
    taxCents,
    totalCents,
    shippingAddress: formattedAddress || null,
    ...attributionColumnsFromMetadata(full.metadata),
    // Use the real Stripe purchase time, not DB insert time — so backfilled
    // orders carry their true date. (`created` is a unix-seconds timestamp.)
    createdAt: new Date(full.created * 1000),
  };
}
