import type { Request, Response } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, ordersTable, productsTable } from "@workspace/db";
import { appendToSheet } from "../lib/sheets";
import { orderRowFromSession } from "../lib/orderFromSession";
import {
  sendConfirmationEmail,
  sendOrderEmail,
  sendTrackingEmail,
  type ConfirmationPack,
  type OrderEmailInput,
  type ShipmentInfo,
} from "../lib/orderEmail";
import { buyLabel } from "../lib/shippo";
import { buildShippingPdf, fetchLabelPdf } from "../lib/packingSlip";

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!sig || !secret || !stripeKey) {
    console.error("[webhook] missing config", { hasSig: !!sig, hasSecret: !!secret, hasKey: !!stripeKey });
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  const stripe = new Stripe(stripeKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, secret);
  } catch (err: any) {
    console.error("[webhook] signature verification failed:", err?.message);
    res.status(400).send(`Webhook Error: ${err?.message ?? "unknown"}`);
    return;
  }

  if (event.type !== "checkout.session.completed") {
    res.json({ received: true, ignored: event.type });
    return;
  }

  try {
    const session = event.data.object as Stripe.Checkout.Session;
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items", "shipping_cost.shipping_rate", "total_details.breakdown"],
    });

    const lineItems = full.line_items?.data ?? [];
    // One product per checkout today, but join defensively in case that changes.
    const itemName = lineItems.map((li) => li.description).filter(Boolean).join(", ") || "Unknown item";
    const orderCount = lineItems.reduce((n, li) => n + (li.quantity ?? 0), 0) || 1;
    const subtotalCents = lineItems.reduce((n, li) => n + (li.amount_subtotal ?? 0), 0);
    const shippingCents = full.shipping_cost?.amount_total ?? 0;
    const taxCents = full.total_details?.amount_tax ?? 0;
    // Promotion codes reduce the total; line item subtotals stay pre-discount.
    const discountCents = full.total_details?.amount_discount ?? 0;
    const totalCents = full.amount_total ?? 0;
    const currency = (full.currency ?? "usd").toUpperCase();
    const customerEmail = full.customer_details?.email ?? "";
    const customerName = full.customer_details?.name ?? "";
    const customerPhone = full.customer_details?.phone ?? "";

    // Prefer the actual tax rate from Stripe's breakdown; fall back to effective.
    const breakdownRate =
      full.total_details?.breakdown?.taxes?.[0]?.rate?.effective_percentage ??
      full.total_details?.breakdown?.taxes?.[0]?.rate?.percentage;
    const taxableBase = subtotalCents - discountCents + shippingCents;
    const taxRate =
      breakdownRate != null
        ? `${breakdownRate}%`
        : taxCents > 0 && taxableBase > 0
          ? `${((taxCents / taxableBase) * 100).toFixed(2)}%`
          : "";

    const shipName = full.shipping_details?.name ?? "";
    const addr = full.shipping_details?.address;

    const paymentIntentId =
      typeof full.payment_intent === "string"
        ? full.payment_intent
        : full.payment_intent?.id ?? "";

    // Save to DB (idempotent: stripe_session_id is UNIQUE). An empty `returning`
    // means this session was already recorded, i.e. a Stripe retry.
    let isNewOrder = true;
    try {
      const inserted = await db
        .insert(ordersTable)
        .values(orderRowFromSession(full))
        .onConflictDoNothing()
        .returning({ id: ordersTable.id });
      isNewOrder = inserted.length > 0;
    } catch (err) {
      // Still alert sales: a paid order has to ship even if the DB write failed.
      // Resend's idempotency key keeps a retry from emailing twice.
      console.error("[webhook] order insert failed:", err);
    }

    const emailInput: OrderEmailInput = {
      sessionId: full.id,
      item: itemName,
      quantity: orderCount,
      subtotal: (subtotalCents / 100).toFixed(2),
      discount: (discountCents / 100).toFixed(2),
      shipping: (shippingCents / 100).toFixed(2),
      tax: (taxCents / 100).toFixed(2),
      taxRate,
      total: (totalCents / 100).toFixed(2),
      currency,
      customerEmail,
      customerName,
      customerPhone,
      shipName,
      address1: addr?.line1 ?? "",
      address2: addr?.line2 ?? "",
      city: addr?.city ?? "",
      state: addr?.state ?? "",
      zip: addr?.postal_code ?? "",
      country: addr?.country ?? "",
      paymentIntentId,
    };

    // Confirm to the customer, buy the label, then email sales the label and
    // packing slip and the customer their tracking. Never throws, and skipped on
    // retries so a label is never bought twice.
    const emailsSent = isNewOrder ? fulfilOrder(full, emailInput) : Promise.resolve();

    // Append to Google Sheet (non-blocking failure).
    // Orders columns:
    // Timestamp | Order ID | Email | Order Count | Phone | Name | Item | Subtotal |
    // Shipping | Tax | Tax Rate | Total | Currency | Ship To Name | Address 1 |
    // Address 2 | City | State | ZIP | Country | Payment Intent
    await appendToSheet("Orders", [
      new Date().toISOString(),
      full.id,
      customerEmail,
      orderCount,
      customerPhone,
      customerName,
      itemName,
      (subtotalCents / 100).toFixed(2),
      (shippingCents / 100).toFixed(2),
      (taxCents / 100).toFixed(2),
      taxRate,
      (totalCents / 100).toFixed(2),
      currency,
      shipName,
      addr?.line1 ?? "",
      addr?.line2 ?? "",
      addr?.city ?? "",
      addr?.state ?? "",
      addr?.postal_code ?? "",
      addr?.country ?? "",
      paymentIntentId,
    ], { dedupeCol: 2 });
    await emailsSent;

    console.log(`[webhook] order recorded: ${full.id} (${customerEmail})`);
  } catch (err) {
    console.error("[webhook] failed to process checkout.session.completed:", err);
    // Return 200 anyway — Stripe will retry on non-2xx, and the DB unique constraint
    // would dupe-fail. The unique constraint on stripe_session_id makes retries safe.
  }

  res.json({ received: true });
}

async function fulfilOrder(full: Stripe.Checkout.Session, emailInput: OrderEmailInput): Promise<void> {
  const confirmed = packForSession(full).then((pack) => sendConfirmationEmail(emailInput, pack));

  const shippingRate = full.shipping_cost?.shipping_rate;
  const label = await buyLabel({
    sessionId: full.id,
    quantity: emailInput.quantity,
    servicelevelToken: full.metadata?.shippoService ?? null,
    displayName: shippingRate && typeof shippingRate === "object" ? shippingRate.display_name : null,
    to: {
      name: emailInput.shipName || emailInput.customerName,
      street1: emailInput.address1,
      street2: emailInput.address2,
      city: emailInput.city,
      state: emailInput.state,
      zip: emailInput.zip,
      country: emailInput.country || "US",
      phone: emailInput.customerPhone,
      email: emailInput.customerEmail,
    },
  });

  let shipment: ShipmentInfo;
  if (label.ok) {
    const { service, costCents, trackingNumber, trackingUrl, fallback } = label;
    shipment = { ok: true, service, costCents, trackingNumber, trackingUrl, fallback };
    try {
      await db
        .update(ordersTable)
        .set({
          shippoTransactionId: label.transactionId,
          trackingNumber,
          trackingUrl: trackingUrl || null,
          labelUrl: label.labelUrl,
          labelCostCents: costCents,
        })
        .where(eq(ordersTable.stripeSessionId, full.id));
    } catch (err) {
      console.error("[webhook] saving label failed:", err);
    }
  } else {
    console.error(`[webhook] no label for ${full.id}: ${label.reason}`);
    shipment = label;
  }

  const locality = [emailInput.city, emailInput.state].filter(Boolean).join(", ");
  const pdf = await buildShippingPdf(
    {
      orderId: full.id,
      date: new Date(full.created * 1000),
      item: emailInput.item,
      quantity: emailInput.quantity,
      shipTo: [
        emailInput.shipName || emailInput.customerName,
        emailInput.address1,
        emailInput.address2,
        [locality, emailInput.zip].filter(Boolean).join(" "),
      ].filter(Boolean),
      ...(label.ok ? { trackingNumber: label.trackingNumber, service: label.service } : {}),
    },
    label.ok ? await fetchLabelPdf(label.labelUrl) : null,
  );

  await Promise.all([
    sendOrderEmail(emailInput, shipment, pdf),
    // Tracking goes after the confirmation so they arrive in order.
    confirmed.then(() => (label.ok ? sendTrackingEmail(emailInput, label) : undefined)),
  ]);
}

// The pack the customer bought, for the confirmation email. Falls back to the
// Stripe line item name (null here) if the product row is gone or the DB errors.
async function packForSession(full: Stripe.Checkout.Session): Promise<ConfirmationPack | null> {
  const productId = Number(full.metadata?.productId);
  if (!productId) return null;
  try {
    const [p] = await db
      .select({
        title: productsTable.title,
        shortTitle: productsTable.shortTitle,
        subtitle: productsTable.subtitle,
        imageUrl: productsTable.imageUrl,
        confirmHeadline: productsTable.confirmHeadline,
        accentColor: productsTable.accentColor,
      })
      .from(productsTable)
      .where(eq(productsTable.id, productId));
    return p ?? null;
  } catch (err) {
    console.error("[webhook] pack lookup failed:", err);
    return null;
  }
}
