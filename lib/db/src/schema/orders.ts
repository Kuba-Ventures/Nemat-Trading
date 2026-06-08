import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  customerEmail: text("customer_email").notNull(),
  customerName: text("customer_name"),
  productId: integer("product_id"),
  quantity: integer("quantity").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull(),
  shippingMethod: text("shipping_method"),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  shippingAddress: text("shipping_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Order = typeof ordersTable.$inferSelect;
