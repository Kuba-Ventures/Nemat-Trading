import { Router } from "express";
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  resolveSetFromTcgUrl,
  fetchRarityCounts,
  computePullData,
  rarityFromSubtitle,
} from "./scryfall";

const router = Router();

// Public: list active products
router.get("/products", async (_req, res) => {
  const products = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.active, true));
  res.json(products);
});

// Admin middleware
function requireAdmin(req: any, res: any, next: any) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Admin: create product
router.post("/admin/products", requireAdmin, async (req, res) => {
  const { title, subtitle, price, imageUrl, stock, specs, contents, expiresAt, scryfallId, discountPercent, tcgplayerUrl, tcgMarketPriceCents, pullProbabilities, possiblePulls, intelReport } = req.body;
  const [product] = await db
    .insert(productsTable)
    .values({
      title,
      subtitle: subtitle ?? "",
      price,
      imageUrl: imageUrl ?? "",
      stock: stock ?? 0,
      specs: JSON.stringify(specs ?? []),
      contents: JSON.stringify(contents ?? []),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      scryfallId: scryfallId ?? "",
      discountPercent: discountPercent ?? 15,
      tcgplayerUrl: tcgplayerUrl ?? "",
      tcgMarketPriceCents: tcgMarketPriceCents ?? null,
      pullProbabilities: JSON.stringify(pullProbabilities ?? []),
      possiblePulls: JSON.stringify(possiblePulls ?? []),
      intelReport: intelReport ?? "",
      active: true,
    })
    .returning();
  res.json(product);
});

// Admin: update product
router.patch("/admin/products/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { title, subtitle, price, imageUrl, stock, active, specs, contents, expiresAt, scryfallId, discountPercent, tcgplayerUrl, tcgMarketPriceCents, pullProbabilities, possiblePulls, intelReport } = req.body;
  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = title;
  if (subtitle !== undefined) updates.subtitle = subtitle;
  if (price !== undefined) updates.price = price;
  if (imageUrl !== undefined) updates.imageUrl = imageUrl;
  if (stock !== undefined) updates.stock = stock;
  if (active !== undefined) updates.active = active;
  if (specs !== undefined) updates.specs = JSON.stringify(specs);
  if (contents !== undefined) updates.contents = JSON.stringify(contents);
  if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (scryfallId !== undefined) updates.scryfallId = scryfallId;
  if (discountPercent !== undefined) updates.discountPercent = discountPercent;
  if (tcgplayerUrl !== undefined) updates.tcgplayerUrl = tcgplayerUrl;
  if (tcgMarketPriceCents !== undefined) updates.tcgMarketPriceCents = tcgMarketPriceCents;
  if (pullProbabilities !== undefined) updates.pullProbabilities = JSON.stringify(pullProbabilities);
  if (possiblePulls !== undefined) updates.possiblePulls = JSON.stringify(possiblePulls);
  if (intelReport !== undefined) updates.intelReport = intelReport;

  const [product] = await db
    .update(productsTable)
    .set(updates)
    .where(eq(productsTable.id, id))
    .returning();
  res.json(product);
});

// Admin: list all products (including inactive)
router.get("/admin/products", requireAdmin, async (_req, res) => {
  const products = await db.select().from(productsTable);
  res.json(products);
});

// Admin: delete product
router.delete("/admin/products/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(productsTable).where(eq(productsTable.id, id));
  res.json({ ok: true });
});

// Admin: re-lock pull probabilities for every product. Recomputes each product's
// tier hit rates + per-card odds from its stored contents + Scryfall set counts,
// using the same model as the lookup. Idempotent — safe to run repeatedly. Used
// to upgrade products created before the accurate-odds model existed.
router.post("/admin/products/relock-pulls", requireAdmin, async (_req, res) => {
  const products = await db.select().from(productsTable);
  const updated: { id: number; title: string; set: string }[] = [];
  const skipped: { id: number; title: string; reason: string }[] = [];

  for (const p of products) {
    try {
      if (!p.tcgplayerUrl) {
        skipped.push({ id: p.id, title: p.title, reason: "no tcgplayerUrl to resolve a set" });
        continue;
      }
      const resolved = await resolveSetFromTcgUrl(p.tcgplayerUrl);
      if (!resolved) {
        skipped.push({ id: p.id, title: p.title, reason: "no matching Scryfall set" });
        continue;
      }

      const contents: string[] = JSON.parse(p.contents || "[]");
      const counts = await fetchRarityCounts(resolved.set.code);
      const { tiers, perCardByRarity } = computePullData(contents, resolved.slug, counts);

      // Re-price the existing possible-pull cards in place (same cards/images —
      // only their locked per-card odds get refreshed) by mapping each card's
      // subtitle to a rarity. Cards we can't classify keep their prior value.
      const possiblePulls = (JSON.parse(p.possiblePulls || "[]") as any[]).map((card) => {
        const rarity = rarityFromSubtitle(card.subtitle ?? "");
        const odds = rarity ? perCardByRarity[rarity] : undefined;
        return odds ? { ...card, probability: odds.display } : card;
      });

      await db
        .update(productsTable)
        .set({
          pullProbabilities: JSON.stringify(tiers),
          possiblePulls: JSON.stringify(possiblePulls),
        })
        .where(eq(productsTable.id, p.id));

      updated.push({ id: p.id, title: p.title, set: resolved.set.code });
    } catch (err: any) {
      skipped.push({ id: p.id, title: p.title, reason: err?.message ?? "compute failed" });
    }
  }

  res.json({ total: products.length, updated, skipped });
});

export default router;
