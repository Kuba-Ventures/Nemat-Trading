import type Stripe from "stripe";

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
  };
}
