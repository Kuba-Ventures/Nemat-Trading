import { Router } from "express";
import { db, subscribersTable, ordersTable, productsTable } from "@workspace/db";
import { appendToSheet } from "../lib/sheets";
import { locationFromIp } from "../lib/geo";

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
      // Geolocate, then append. Both are best-effort and must never block/throw
      // the response — fire and forget. Email List columns:
      // Timestamp | Email | Location | Status
      locationFromIp(req.ip)
        .then((location) =>
          appendToSheet("Email List", [
            new Date().toISOString(),
            normalized,
            location,
            "Member",
          ]),
        )
        .catch((err) => console.error("[subscribe] sheet append failed:", err));
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
  // Email List: Timestamp | Email | Location | Status
  // (Location is blank for backfill — no IP captured at original signup time.)
  for (const s of subs) {
    await appendToSheet("Email List", [
      s.subscribedAt.toISOString(),
      s.email,
      "",
      "Member",
    ]);
  }

  const orders = await db.select().from(ordersTable).orderBy(ordersTable.createdAt);
  const products = await db.select().from(productsTable);
  const titleById = new Map(products.map((p) => [p.id, p.title]));
  // Orders columns (best-effort from DB — phone, payment intent, and split
  // address fields aren't stored, so they're blank on backfilled rows):
  // Timestamp | Order ID | Email | Order Count | Phone | Name | Item | Subtotal |
  // Shipping | Tax | Tax Rate | Total | Currency | Ship To Name | Address 1 |
  // Address 2 | City | State | ZIP | Country | Payment Intent
  for (const o of orders) {
    const taxableBase = o.subtotalCents + o.shippingCents;
    const taxRate =
      o.taxCents > 0 && taxableBase > 0
        ? `${((o.taxCents / taxableBase) * 100).toFixed(2)}%`
        : "";
    await appendToSheet("Orders", [
      o.createdAt.toISOString(),
      o.stripeSessionId,
      o.customerEmail,
      o.quantity,
      "",
      o.customerName ?? "",
      o.productId != null ? titleById.get(o.productId) ?? "" : "",
      (o.subtotalCents / 100).toFixed(2),
      (o.shippingCents / 100).toFixed(2),
      (o.taxCents / 100).toFixed(2),
      taxRate,
      (o.totalCents / 100).toFixed(2),
      "USD",
      o.customerName ?? "",
      o.shippingAddress ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }

  res.json({ subscribers: subs.length, orders: orders.length });
});

export default router;
