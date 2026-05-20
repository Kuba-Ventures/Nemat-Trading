import type { Request, Response } from "express";
import Stripe from "stripe";
import { db, ordersTable } from "@workspace/db";
import { appendToSheet } from "../lib/sheets";

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
      expand: ["line_items", "shipping_cost.shipping_rate"],
    });

    const lineItem = full.line_items?.data[0];
    const itemName = lineItem?.description ?? "Unknown item";
    const quantity = lineItem?.quantity ?? 1;
    const subtotalCents = lineItem?.amount_subtotal ?? 0;
    const shippingCents = full.shipping_cost?.amount_total ?? 0;
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

    // Save to DB (idempotent: stripe_session_id is UNIQUE)
    await db
      .insert(ordersTable)
      .values({
        stripeSessionId: full.id,
        customerEmail,
        customerName: customerName || null,
        productId,
        quantity,
        subtotalCents,
        shippingCents,
        shippingMethod: shippingMethod || null,
        totalCents,
        shippingAddress: formattedAddress || null,
      })
      .onConflictDoNothing();

    // Append to Google Sheet (non-blocking failure)
    await appendToSheet("Orders", [
      new Date().toISOString(),
      customerName,
      customerEmail,
      itemName,
      quantity,
      (subtotalCents / 100).toFixed(2),
      (shippingCents / 100).toFixed(2),
      shippingMethod,
      (totalCents / 100).toFixed(2),
      formattedAddress,
      full.id,
    ]);

    console.log(`[webhook] order recorded: ${full.id} (${customerEmail})`);
  } catch (err) {
    console.error("[webhook] failed to process checkout.session.completed:", err);
    // Return 200 anyway — Stripe will retry on non-2xx, and the DB unique constraint
    // would dupe-fail. The unique constraint on stripe_session_id makes retries safe.
  }

  res.json({ received: true });
}
