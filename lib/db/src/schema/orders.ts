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
  // Ad attribution captured in the browser and passed through Stripe metadata.
  fbclid: text("fbclid"),
  fbc: text("fbc"),
  fbp: text("fbp"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  landedAt: text("landed_at"),
  // Shippo label bought by the webhook (issue #113). Null if none was bought.
  shippoTransactionId: text("shippo_transaction_id"),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  labelUrl: text("label_url"),
  labelCostCents: integer("label_cost_cents"),
  // Fulfillment timeline for the admin shipping view. label_created_at is when the
  // tracking number reached us (Shippo purchase or "Mark shipped"); shipped_at and
  // delivered_at come from the carrier's tracking history via Shippo's tracking API.
  labelCreatedAt: timestamp("label_created_at"),
  shippedAt: timestamp("shipped_at"),
  deliveredAt: timestamp("delivered_at"),
  trackingStatus: text("tracking_status"),
  trackingStatusDetail: text("tracking_status_detail"),
  trackingLocation: text("tracking_location"),
  trackingCheckedAt: timestamp("tracking_checked_at"),
  trackingEmailedAt: timestamp("tracking_emailed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Order = typeof ordersTable.$inferSelect;
