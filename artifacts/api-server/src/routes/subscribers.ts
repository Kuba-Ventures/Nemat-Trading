import { Router } from "express";
import { db, subscribersTable, ordersTable, productsTable } from "@workspace/db";
import { appendToSheet, clearSheet } from "../lib/sheets";
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

// Admin: re-emit all subscribers and orders to the sheet (full re-sync).
// Clears each tab's data rows first (via the Apps Script) so re-running is
// idempotent and never duplicates. If the sheet can't be reached — the usual
// cause is a SHEETS_WEBHOOK_URL/secret or Apps Script access misconfig — abort
// before writing anything and return the specific reason.
router.post("/admin/sync-sheets", requireAdmin, async (_req, res) => {
  const clearedEmail = await clearSheet("Email List");
  const clearedOrders = await clearSheet("Orders");
  if (!clearedEmail.ok || !clearedOrders.ok) {
    res.status(502).json({
      error:
        "Couldn't reach the Google Sheet. Check SHEETS_WEBHOOK_URL + secret and the Apps Script web-app deployment.",
      detail: { emailList: clearedEmail.error, orders: clearedOrders.error },
    });
    return;
  }

  const subs = await db
    .select()
    .from(subscribersTable)
    .orderBy(subscribersTable.subscribedAt);
  // Email List: Timestamp | Email | Location | Status
  // (Location is blank for backfill — no IP captured at original signup time.)
  let emailSynced = 0;
  let emailFailed = 0;
  for (const s of subs) {
    const r = await appendToSheet("Email List", [
      s.subscribedAt.toISOString(),
      s.email,
      "",
      "Member",
    ]);
    r.ok ? emailSynced++ : emailFailed++;
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
    ]);
    r.ok ? ordersSynced++ : ordersFailed++;
  }

  res.json({
    subscribers: { total: subs.length, synced: emailSynced, failed: emailFailed },
    orders: { total: orders.length, synced: ordersSynced, failed: ordersFailed },
  });
});

export default router;
