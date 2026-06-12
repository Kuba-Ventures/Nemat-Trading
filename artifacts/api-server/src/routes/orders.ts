import { Router } from "express";
import Stripe from "stripe";
import { db, ordersTable, productsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { orderRowFromSession } from "../lib/orderFromSession";

const router = Router();

// Admin middleware (same shared-secret pattern as products/subscribers routes).
function requireAdmin(req: any, res: any, next: any) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Admin: list all completed orders, newest first, with product titles resolved.
router.get("/admin/orders", requireAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(ordersTable)
      .orderBy(desc(ordersTable.createdAt));

    const products = await db.select().from(productsTable);
    const titleById = new Map(products.map((p) => [p.id, p.title]));

    const orders = rows.map((o) => ({
      id: o.id,
      date: o.createdAt.toISOString(),
      email: o.customerEmail,
      name: o.customerName,
      item: o.productId != null ? titleById.get(o.productId) ?? "Item" : "Item",
      quantity: o.quantity,
      subtotalCents: o.subtotalCents,
      shippingCents: o.shippingCents,
      taxCents: o.taxCents,
      totalCents: o.totalCents,
      shippingMethod: o.shippingMethod,
      shippingAddress: o.shippingAddress,
      stripeSessionId: o.stripeSessionId,
    }));

    res.json(orders);
  } catch (err) {
    console.error("[admin/orders] failed to load orders:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

// Admin: backfill orders from Stripe. Pulls completed/paid Checkout Sessions
// and inserts any that aren't already in the DB (idempotent via the unique
// stripe_session_id). Used to recover orders that predate the tax_cents fix,
// when the webhook INSERT was failing. Safe to run repeatedly.
router.post("/admin/backfill-orders", requireAdmin, async (_req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(500).json({ error: "STRIPE_SECRET_KEY not configured" });
    return;
  }
  const stripe = new Stripe(stripeKey);

  let scanned = 0;
  let inserted = 0;
  let skipped = 0;

  try {
    // Walk every Checkout Session (auto-paginates).
    for await (const session of stripe.checkout.sessions.list({ limit: 100 })) {
      scanned++;
      if (session.status !== "complete" || session.payment_status !== "paid") {
        skipped++;
        continue;
      }
      // Re-retrieve with the expansions orderRowFromSession needs.
      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items", "shipping_cost.shipping_rate", "total_details.breakdown"],
      });
      const result = await db
        .insert(ordersTable)
        .values(orderRowFromSession(full))
        .onConflictDoNothing()
        .returning({ id: ordersTable.id });
      if (result.length > 0) inserted++;
      else skipped++;
    }
    res.json({ scanned, inserted, skipped });
  } catch (err: any) {
    console.error("[admin/backfill-orders] failed:", err);
    res.status(500).json({ error: err?.message ?? "Backfill failed", scanned, inserted });
  }
});

export default router;
