import { Router } from "express";
import Stripe from "stripe";
import { db, ordersTable, productsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { orderRowFromSession, skipBackfillSession } from "../lib/orderFromSession";
import { requireAdmin } from "../lib/adminAuth";
import {
  SHIPPED_ELSEWHERE,
  emailTrackingOnce,
  markShippedOnce,
  markShippedUntracked,
  refreshStaleTracking,
  refreshTracking,
} from "../lib/fulfilment";
import { shipTiming } from "../lib/shipStatus";
import { carrierFor, normalizeTracking, trackingUrlFor } from "../lib/tracking";

const router = Router();

// Admin: list all completed orders, newest first, with product titles resolved.
router.get("/admin/orders", requireAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(ordersTable)
      .orderBy(desc(ordersTable.createdAt));

    const products = await db.select().from(productsTable);
    const titleById = new Map(products.map((p) => [p.id, p.title]));

    const now = new Date();
    const orders = rows.map((o) => {
      const shippedElsewhere = o.shippoTransactionId === SHIPPED_ELSEWHERE;
      const timing = shipTiming(
        {
          createdAt: o.createdAt,
          trackingNumber: o.trackingNumber,
          shippedElsewhere,
          trackingStatus: o.trackingStatus,
          labelCreatedAt: o.labelCreatedAt,
          shippedAt: o.shippedAt,
        },
        now,
      );
      return {
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
      shipping: {
        stage: timing.stage,
        days: timing.days,
        late: timing.late,
        carrier: o.trackingNumber ? carrierFor(o.trackingNumber) : null,
        trackingNumber: o.trackingNumber,
        trackingUrl: o.trackingUrl,
        status: o.trackingStatus,
        statusDetail: o.trackingStatusDetail,
        location: o.trackingLocation,
        labelCreatedAt: o.labelCreatedAt?.toISOString() ?? null,
        shippedAt: o.shippedAt?.toISOString() ?? null,
        deliveredAt: o.deliveredAt?.toISOString() ?? null,
        checkedAt: o.trackingCheckedAt?.toISOString() ?? null,
        emailedAt: o.trackingEmailedAt?.toISOString() ?? null,
      },
    };
    });

    res.json(orders);
  } catch (err) {
    console.error("[admin/orders] failed to load orders:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

// Admin: save a tracking number for an order (e.g. one Shawn emailed over).
// Only works on an order with no label yet, so it can never overwrite tracking.
router.post("/admin/orders/:sessionId/tracking", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const trackingNumber = normalizeTracking(req.body?.tracking);
  if (!trackingNumber) {
    res.status(400).json({ error: "That doesn't look like a tracking number" });
    return;
  }
  try {
    const saved = await markShippedOnce(sessionId, { trackingNumber, trackingUrl: trackingUrlFor(trackingNumber) });
    if (!saved) {
      res.status(409).json({ error: "This order already has a label or is marked shipped" });
      return;
    }
    await refreshTracking(sessionId);
    const emailed = req.body?.emailCustomer === false ? false : await emailTrackingOnce(sessionId);
    res.json({ ok: true, emailed });
  } catch (err) {
    console.error("[admin/orders] saving tracking failed:", err);
    res.status(500).json({ error: "Couldn't save the tracking number" });
  }
});

// Admin: mark shipped with no tracking (a test order, or an old one with no number).
router.post("/admin/orders/:sessionId/shipped-untracked", requireAdmin, async (req, res) => {
  try {
    const saved = await markShippedUntracked(String(req.params.sessionId));
    if (!saved) {
      res.status(409).json({ error: "This order already has a label or is marked shipped" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin/orders] mark shipped failed:", err);
    res.status(500).json({ error: "Couldn't update the order" });
  }
});

// Admin: email the customer their tracking (if it hasn't gone out yet).
router.post("/admin/orders/:sessionId/email-tracking", requireAdmin, async (req, res) => {
  try {
    const sent = await emailTrackingOnce(String(req.params.sessionId));
    res.json({ ok: true, sent });
  } catch (err) {
    console.error("[admin/orders] tracking email failed:", err);
    res.status(500).json({ error: "Couldn't send the tracking email" });
  }
});

// Admin: refresh carrier status for every order still on its way.
router.post("/admin/orders/refresh-tracking", requireAdmin, async (_req, res) => {
  try {
    const refreshed = await refreshStaleTracking(new Date(Date.now() + 24 * 60 * 60 * 1000));
    res.json({ ok: true, refreshed });
  } catch (err) {
    console.error("[admin/orders] refresh failed:", err);
    res.status(500).json({ error: "Couldn't refresh tracking" });
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
  let updated = 0;
  let skipped = 0;

  try {
    // Existing session ids, so we can report inserted vs. updated.
    const existingRows = await db
      .select({ sid: ordersTable.stripeSessionId })
      .from(ordersTable);
    const existing = new Set(existingRows.map((r) => r.sid));

    // Walk every Checkout Session (auto-paginates).
    for await (const session of stripe.checkout.sessions.list({ limit: 100, expand: ["data.payment_intent.latest_charge"] })) {
      scanned++;
      if (session.status !== "complete" || session.payment_status !== "paid" || skipBackfillSession(session, existing)) {
        skipped++;
        continue;
      }
      // Re-retrieve with the expansions orderRowFromSession needs.
      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items", "shipping_cost.shipping_rate", "total_details.breakdown"],
      });
      const row = orderRowFromSession(full);
      // Upsert: insert new orders, and reconcile existing ones with Stripe
      // (notably the real purchase date) so re-running fixes prior imports.
      await db
        .insert(ordersTable)
        .values(row)
        .onConflictDoUpdate({ target: ordersTable.stripeSessionId, set: row });
      if (existing.has(full.id)) updated++;
      else inserted++;
    }
    res.json({ scanned, inserted, updated, skipped });
  } catch (err: any) {
    console.error("[admin/backfill-orders] failed:", err);
    res.status(500).json({ error: err?.message ?? "Backfill failed", scanned, inserted, updated });
  }
});

export default router;
