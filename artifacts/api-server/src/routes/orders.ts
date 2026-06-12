import { Router } from "express";
import { db, ordersTable, productsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

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

export default router;
