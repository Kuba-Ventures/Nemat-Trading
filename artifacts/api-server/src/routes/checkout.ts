import { Router } from "express";
import Stripe from "stripe";
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { attributionToMetadata, sanitizeAttribution } from "../lib/attribution";
import { normalizeEmail, resolvePromo } from "../lib/promo";
import { createRateLimiter } from "../lib/rate-limit";

const SHIPPO_API = "https://api.goshippo.com";

type ShippoRate = {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel: { name: string; token: string };
};

const router = Router();

// Hardcap on how many of a single item one order may contain. This is the
// authoritative enforcement point: quantity reaches us as a client-controlled
// value (URL param -> request body), so the frontend selector cap is only a
// nudge and the real limit must be enforced here.
const MAX_QUANTITY_PER_ORDER = 2;

// Each check lists the email's past Stripe sessions, so cap how often one
// client can probe codes and emails.
const promoLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });

// Checks a promo code for this email before payment, so the checkout page can
// show the discount. POST /checkout re-checks; this answer is never trusted.
router.post("/checkout/promo", promoLimiter, async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(500).json({ error: "Stripe not configured" });
    return;
  }
  const { code, email } = req.body as { code?: unknown; email?: unknown };
  try {
    const result = await resolvePromo(new Stripe(stripeKey), code, email);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { code: appliedCode, percentOff, amountOffCents } = result.promo;
    res.json({ code: appliedCode, percentOff, amountOffCents });
  } catch (err) {
    console.error("[checkout/promo] lookup failed:", err);
    res.status(502).json({ error: "Couldn't check that code. Try again." });
  }
});

router.post("/checkout", async (req, res) => {
  console.log("[checkout] body:", JSON.stringify(req.body));
  const { productId, quantity, shippingRateId, attribution, promoCode, email } = req.body as {
    productId: number;
    quantity: number;
    shippingRateId?: string;
    attribution?: unknown;
    promoCode?: unknown;
    email?: unknown;
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

  // A promo code is only honoured here, after the once-per-customer check.
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
  let customerEmail: string | undefined;
  if (promoCode !== undefined && promoCode !== null && promoCode !== "") {
    const result = await resolvePromo(stripe, promoCode, email);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    discounts = [{ promotion_code: result.promo.id }];
    // Locks the email on Stripe's page so it matches the one we checked.
    customerEmail = normalizeEmail(email) ?? undefined;
  }

  // FRONTEND_URL can be a comma-separated CORS allowlist (see app.ts); Stripe
  // needs a single base URL, so use the first entry (the primary domain).
  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:5173")
    .split(",")[0]
    .trim();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    automatic_tax: { enabled: true },
    // Promo codes come from our checkout page (see lib/promo.ts). Stripe's own
    // promo box stays off so a code can't bypass the once-per-customer check.
    discounts,
    customer_email: customerEmail,
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
      // The service the customer paid for, so the label buys the same one.
      shippoService: rate.servicelevel.token,
      // Ad click id + UTM tags, so the order can be matched to a Meta ad.
      ...attributionToMetadata(sanitizeAttribution(attribution)),
    },
    success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/checkout?qty=${quantity}`,
  });

  res.json({ url: session.url });
});

// Minimal, PII-free lookup used by the /success page to fire a Meta Purchase
// with the real order value. Retrieving from Stripe (rather than our orders
// table) avoids a race with the async webhook that records the order. Only
// paid sessions return data, and only the total + currency are exposed, never
// customer details.
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
    const session = await stripe.checkout.sessions.retrieve(id);
    if (session.payment_status !== "paid") {
      res.status(404).json({ error: "session not completed" });
      return;
    }
    res.json({
      value: session.amount_total != null ? session.amount_total / 100 : null,
      currency: (session.currency ?? "usd").toUpperCase(),
      orderId: session.id,
    });
  } catch {
    res.status(404).json({ error: "session not found" });
  }
});

export default router;
