import { Router } from "express";
import { db, ordersTable, productsTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";
import { emailFromAuthHeader } from "../lib/supabaseAuth";

const router = Router();

// Authenticated: return the signed-in customer's order history.
// Identity comes from a Supabase access token (magic-link verified), and orders
// are matched to the user's verified email — case-insensitive, since Stripe and
// Supabase may store the same address with different casing.
router.get("/account/orders", async (req, res) => {
  const email = await emailFromAuthHeader(req.headers.authorization);
  if (!email) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(ordersTable)
      .where(sql`lower(${ordersTable.customerEmail}) = ${email}`)
      .orderBy(desc(ordersTable.createdAt));

    const products = await db.select().from(productsTable);
    const titleById = new Map(products.map((p) => [p.id, p.title]));

    const orders = rows.map((o) => ({
      id: o.id,
      date: o.createdAt.toISOString(),
      item: o.productId != null ? titleById.get(o.productId) ?? "Item" : "Item",
      quantity: o.quantity,
      subtotalCents: o.subtotalCents,
      shippingCents: o.shippingCents,
      taxCents: o.taxCents,
      totalCents: o.totalCents,
      shippingMethod: o.shippingMethod,
    }));

    res.json({ email, orders });
  } catch (err) {
    console.error("[account] failed to load orders:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

export default router;
