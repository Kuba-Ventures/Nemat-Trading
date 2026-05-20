import { Router } from "express";
import { db, subscribersTable, ordersTable, productsTable } from "@workspace/db";
import { appendToSheet } from "../lib/sheets";

const router = Router();

// Public: subscribe
router.post("/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  const normalized = email.trim().toLowerCase();
  try {
    const inserted = await db
      .insert(subscribersTable)
      .values({ email: normalized })
      .onConflictDoNothing()
      .returning();
    // Only sync to sheet on fresh inserts (skip dupes)
    if (inserted.length > 0) {
      appendToSheet("Waitlist", [
        new Date().toISOString(),
        normalized,
        "site",
      ]).catch((err) => console.error("[subscribe] sheet append failed:", err));
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

// Admin middleware (reused from products)
function requireAdmin(req: any, res: any, next: any) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Admin: list all subscribers
router.get("/admin/subscribers", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(subscribersTable)
    .orderBy(subscribersTable.subscribedAt);
  res.json(rows);
});

// Admin: re-emit all subscribers and orders to the sheet (one-shot backfill).
// Sheet rows will be appended — clear any existing data rows first to avoid dupes.
router.post("/admin/sync-sheets", requireAdmin, async (_req, res) => {
  const subs = await db
    .select()
    .from(subscribersTable)
    .orderBy(subscribersTable.subscribedAt);
  for (const s of subs) {
    await appendToSheet("Waitlist", [
      s.subscribedAt.toISOString(),
      s.email,
      "site",
    ]);
  }

  const orders = await db.select().from(ordersTable).orderBy(ordersTable.createdAt);
  const products = await db.select().from(productsTable);
  const titleById = new Map(products.map((p) => [p.id, p.title]));
  for (const o of orders) {
    await appendToSheet("Orders", [
      o.createdAt.toISOString(),
      o.customerName ?? "",
      o.customerEmail,
      o.productId != null ? titleById.get(o.productId) ?? "" : "",
      o.quantity,
      (o.subtotalCents / 100).toFixed(2),
      (o.shippingCents / 100).toFixed(2),
      o.shippingMethod ?? "",
      (o.totalCents / 100).toFixed(2),
      o.shippingAddress ?? "",
      o.stripeSessionId,
    ]);
  }

  res.json({ subscribers: subs.length, orders: orders.length });
});

export default router;
