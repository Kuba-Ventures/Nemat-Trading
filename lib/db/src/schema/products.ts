import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
// drizzle-zod 0.8.x emits zod v4 schema types; import z from the matching v4
// entrypoint (zod 3.25 ships both) so z.infer aligns with createInsertSchema's output.
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  price: integer("price").notNull(), // in cents, e.g. 3200 = $32.00
  imageUrl: text("image_url").notNull().default(""),
  stock: integer("stock").notNull().default(0),
  active: boolean("active").notNull().default(true),
  specs: text("specs").notNull().default("[]"), // JSON string
  contents: text("contents").notNull().default("[]"), // JSON string
  expiresAt: timestamp("expires_at"),
  scryfallId: text("scryfall_id").default(""),        // used to fetch live TCG price via Scryfall
  discountPercent: integer("discount_percent").notNull().default(15),
  tcgplayerUrl: text("tcgplayer_url").default(""),   // link to TCGPlayer listing
  tcgMarketPriceCents: integer("tcg_market_price_cents"), // cached TCG market price in cents
  pullProbabilities: text("pull_probabilities").notNull().default("[]"), // JSON array
  possiblePulls: text("possible_pulls").notNull().default("[]"),         // JSON array
  intelReport: text("intel_report").notNull().default(""),               // plain text, paragraphs separated by \n\n
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
