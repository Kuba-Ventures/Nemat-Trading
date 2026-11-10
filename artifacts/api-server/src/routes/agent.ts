import { Router } from "express";
import Stripe from "stripe";
import { db, ordersTable, productsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAgentKey } from "../lib/agentKey";
import { AGENT_FIELDS, parseAgentUpdate, parseRefund } from "../lib/agentActions";

// Agent routes (x-agent-key, held only by the Content Hub). Reads: products and recent orders. Writes: the
// allow-listed product fields and order refunds, each one a change Finley approved on the agents board.
const router = Router();

const view = (p: typeof productsTable.$inferSelect) => ({
  id: p.id, title: p.title, shortTitle: p.shortTitle, subtitle: p.subtitle, priceCents: p.price, discountPercent: p.discountPercent, stock: p.stock, active: p.active, expiresAt: p.expiresAt,
});

router.get("/agent/products", requireAgentKey, async (_req, res) => {
  const products = await db.select().from(productsTable);
  res.json({ products: products.map(view), editable: AGENT_FIELDS });
});

router.patch("/agent/products/:id", requireAgentKey, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad product id" }); return; }
  const parsed = parseAgentUpdate(req.body);
  if ("error" in parsed) { res.status(400).json(parsed); return; }
  const [before] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!before) { res.status(404).json({ error: "No such product" }); return; }
  const [after] = await db.update(productsTable).set(parsed.updates as any).where(eq(productsTable.id, id)).returning();
  const changed = Object.fromEntries(Object.keys(parsed.updates).map((k) => [k === "price" ? "priceCents" : k, { from: (before as any)[k], to: (after as any)[k] }]));
  console.info("[agent-action]", JSON.stringify({ at: new Date().toISOString(), productId: id, changed, approval: parsed.approval, reason: parsed.reason }));
  res.json({ product: view(after), changed });
});

// Recent orders with what's needed to answer "where's my order" and to refund: no street address, no card details.
router.get("/agent/orders", requireAgentKey, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const rows = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(limit);
  const products = await db.select().from(productsTable);
  const titleById = new Map(products.map((p) => [p.id, p.title]));
  res.json({ orders: rows.map((o: any) => ({
    sessionId: o.stripeSessionId, date: o.createdAt, name: o.customerName, email: o.customerEmail,
    item: o.productId != null ? titleById.get(o.productId) ?? "Item" : "Item", quantity: o.quantity, totalCents: o.totalCents,
    shippingMethod: o.shippingMethod, trackingNumber: o.trackingNumber, trackingStatus: o.trackingStatus, shippedAt: o.shippedAt, deliveredAt: o.deliveredAt,
  })) });
});

// Refund one order (full, or amountCents). Stripe's idempotency key is the approval, so one approval refunds once.
router.post("/agent/orders/:sessionId/refund", requireAgentKey, async (req, res) => {
  const parsed = parseRefund(req.body);
  if ("error" in parsed) { res.status(400).json(parsed); return; }
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) { res.status(503).json({ error: "Stripe isn't configured" }); return; }
  const sessionId = String(req.params.sessionId);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.stripeSessionId, sessionId));
  if (!order) { res.status(404).json({ error: "No such order" }); return; }
  const stripe = new Stripe(stripeKey);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntent) { res.status(409).json({ error: "This order has no payment to refund" }); return; }
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntent, ...(parsed.amountCents ? { amount: parsed.amountCents } : {}), metadata: { approval: parsed.approval, reason: parsed.reason.slice(0, 200), source: "agent-key" } },
      { idempotencyKey: `agent-refund-${parsed.approval}` },
    );
    console.info("[agent-action]", JSON.stringify({ at: new Date().toISOString(), refund: refund.id, sessionId, amountCents: refund.amount, status: refund.status, approval: parsed.approval, reason: parsed.reason }));
    res.json({ refund: { id: refund.id, amountCents: refund.amount, status: refund.status }, order: { sessionId, name: order.customerName, totalCents: order.totalCents } });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Stripe refused the refund" });
  }
});

export default router;
