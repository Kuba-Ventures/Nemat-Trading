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
          ], { dedupeCol: 2 }),
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

// Admin: backfill all subscribers and orders from the DB into the sheet.
// NON-DESTRUCTIVE: appends only rows not already present (dedupe by Email / Order
// ID via the Apps Script), and never clears or removes anything. Safe to re-run.
// Surfaces the first failure reason (usually a SHEETS_WEBHOOK_URL/secret or Apps
// Script access misconfig) so a broken sync is diagnosable instead of silent.
router.post("/admin/sync-sheets", requireAdmin, async (_req, res) => {
  let firstError: string | undefined;

  const subs = await db
    .select()
    .from(subscribersTable)
    .orderBy(subscribersTable.subscribedAt);
  // Email List: Timestamp | Email | Location | Status (dedupe on Email, col 2).
  // (Location is blank for backfill — no IP captured at original signup time.)
  let emailSynced = 0;
  let emailFailed = 0;
  for (const s of subs) {
    const r = await appendToSheet(
      "Email List",
      [s.subscribedAt.toISOString(), s.email, "", "Member"],
      { dedupeCol: 2 },
    );
    if (r.ok) emailSynced++;
    else { emailFailed++; firstError ??= r.error; }
  }

  const orders = await db.select().from(ordersTable).orderBy(ordersTable.createdAt);
  const products = await db.select().from(productsTable);
  const titleById = new Map(products.map((p) => [p.id, p.title]));
  let ordersSynced = 0;
  let ordersFailed = 0;
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
    const r = await appendToSheet("Orders", [
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
    ], { dedupeCol: 2 });
    if (r.ok) ordersSynced++;
    else { ordersFailed++; firstError ??= r.error; }
  }

  res.json({
    subscribers: { total: subs.length, synced: emailSynced, failed: emailFailed },
    orders: { total: orders.length, synced: ordersSynced, failed: ordersFailed },
    error: firstError,
  });
});

export default router;
