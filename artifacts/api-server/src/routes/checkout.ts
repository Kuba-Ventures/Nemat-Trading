import { Router } from "express";
import Stripe from "stripe";
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SHIPPO_API = "https://api.goshippo.com";

type ShippoRate = {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel: { name: string };
};

const router = Router();

// Hardcap on how many of a single item one order may contain. This is the
// authoritative enforcement point: quantity reaches us as a client-controlled
// value (URL param -> request body), so the frontend selector cap is only a
// nudge and the real limit must be enforced here.
const MAX_QUANTITY_PER_ORDER = 2;

router.post("/checkout", async (req, res) => {
  console.log("[checkout] body:", JSON.stringify(req.body));
  const { productId, quantity, shippingRateId } = req.body as {
    productId: number;
    quantity: number;
    shippingRateId?: string;
  };

  if (!productId || !quantity || !Number.isInteger(quantity) || quantity < 1) {
    res.status(400).json({ error: `productId and a whole-number quantity are required (got productId=${productId}, quantity=${quantity})` });
    return;
  }
  if (quantity > MAX_QUANTITY_PER_ORDER) {
    res.status(400).json({ error: `Limit ${MAX_QUANTITY_PER_ORDER} per item per order (got quantity=${quantity})` });
    return;
  }
  if (!shippingRateId || typeof shippingRateId !== "string") {
    res.status(400).json({ error: "shippingRateId is required — get one from /api/shipping/rates first" });
    return;
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(500).json({ error: "Stripe not configured" });
    return;
  }
  const shippoToken = process.env.SHIPPO_API_TOKEN;
  if (!shippoToken) {
    res.status(500).json({ error: "Shipping not configured" });
    return;
  }

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId));

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  // Re-fetch the rate from Shippo to get the authoritative amount.
  // This prevents a malicious client from passing a fake $0 rate.
  const rateRes = await fetch(`${SHIPPO_API}/rates/${shippingRateId}/`, {
    headers: { Authorization: `ShippoToken ${shippoToken}` },
  });
  if (!rateRes.ok) {
    res.status(400).json({ error: "Invalid or expired shipping rate" });
    return;
  }
  const rate = (await rateRes.json()) as ShippoRate;
  const shippingCents = Math.round(parseFloat(rate.amount) * 100);
  const shippingLabel = `${rate.provider} ${rate.servicelevel.name}`;

  const stripe = new Stripe(stripeKey);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    automatic_tax: { enabled: true },
    line_items: [
      {
        quantity,
        price_data: {
          currency: "usd",
          unit_amount: product.price, // already in cents
          tax_behavior: "exclusive", // tax added on top of the listed price
          product_data: {
            name: product.title,
            description: product.subtitle || undefined,
            images: product.imageUrl ? [product.imageUrl] : undefined,
            tax_code: "txcd_99999999", // General - Tangible Goods
          },
        },
      },
    ],
    shipping_address_collection: { allowed_countries: ["US"] },
    phone_number_collection: { enabled: true },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: shippingLabel,
          fixed_amount: { amount: shippingCents, currency: "usd" },
          tax_behavior: "exclusive",
          // Stripe Tax decides shipping taxability per jurisdiction from this code
          tax_code: "txcd_92010001", // Shipping
        },
      },
    ],
    metadata: {
      productId: String(productId),
    },
    success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/checkout?qty=${quantity}`,
  });

  res.json({ url: session.url });
});

// Order lookup for the /success page: fires the Meta Purchase with the real
// order value and renders the pack-specific confirmation. Retrieving from
// Stripe (rather than our orders table) avoids a race with the async webhook
// that records the order. Only paid sessions return data. The ship-to name and
// address are included, the same as Stripe's own hosted confirmation: the
// session id is an unguessable secret handed only to the buyer. Email, phone
// and payment details are never exposed.
router.get("/checkout/session/:id", async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(500).json({ error: "Stripe not configured" });
    return;
  }
  const { id } = req.params;
  if (!id || !id.startsWith("cs_")) {
    res.status(400).json({ error: "invalid session id" });
    return;
  }
  try {
    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items"] });
    if (session.payment_status !== "paid") {
      res.status(404).json({ error: "session not completed" });
      return;
    }
    // The pack they bought, so the confirmation page can be pack-specific.
    const productId = Number(session.metadata?.productId);
    const [pack] = productId
      ? await db
          .select({
            title: productsTable.title,
            shortTitle: productsTable.shortTitle,
            subtitle: productsTable.subtitle,
            imageUrl: productsTable.imageUrl,
          })
          .from(productsTable)
          .where(eq(productsTable.id, productId))
      : [];
    res.json({
      value: session.amount_total != null ? session.amount_total / 100 : null,
      currency: (session.currency ?? "usd").toUpperCase(),
      orderId: session.id,
      quantity: session.line_items?.data[0]?.quantity ?? 1,
      subtotal: (session.amount_subtotal ?? 0) / 100,
      shipping: (session.shipping_cost?.amount_total ?? 0) / 100,
      tax: (session.total_details?.amount_tax ?? 0) / 100,
      shipTo: session.shipping_details
        ? {
            name: session.shipping_details.name ?? "",
            line1: session.shipping_details.address?.line1 ?? "",
            line2: session.shipping_details.address?.line2 ?? "",
            city: session.shipping_details.address?.city ?? "",
            state: session.shipping_details.address?.state ?? "",
            zip: session.shipping_details.address?.postal_code ?? "",
          }
        : null,
      pack: pack ?? null,
    });
  } catch {
    res.status(404).json({ error: "session not found" });
  }
});

export default router;
