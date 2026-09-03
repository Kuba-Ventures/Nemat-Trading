import { Router } from "express";
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  resolveSetFromTcgUrl,
  fetchRarityCounts,
  fetchSpecialTreatments,
  computePullData,
  fetchTopCardsByValue,
  buildPossiblePulls,
} from "./scryfall";
import { currentWindowEnd } from "../lib/drop-window";

const router = Router();

type ProductRow = typeof productsTable.$inferSelect;

/**
 * Advance any lapsed deadline to its current window and persist it, so a live
 * drop restarts on its own instead of sitting on "Deal Expired" until someone
 * edits it.
 *
 * Only active products roll: a deactivated drop keeps the deadline it had, so
 * reactivating it does not silently rewrite its history. Rolling is idempotent
 * and derived purely from the stored date, so concurrent requests compute the
 * same target and cannot race to different values.
 */
async function rollLapsedWindows(products: ProductRow[]): Promise<ProductRow[]> {
  const now = new Date();
  return Promise.all(
    products.map(async (product) => {
      if (!product.active || !product.expiresAt) return product;
      const rolled = currentWindowEnd(product.expiresAt, now);
      if (rolled.getTime() === product.expiresAt.getTime()) return product;
      await db
        .update(productsTable)
        .set({ expiresAt: rolled })
        .where(eq(productsTable.id, product.id));
      return { ...product, expiresAt: rolled };
    }),
  );
}

// Public: list active products
router.get("/products", async (_req, res) => {
  const products = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.active, true));
  res.json(await rollLapsedWindows(products));
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
  const { title, shortTitle, subtitle, price, imageUrl, stock, specs, contents, expiresAt, scryfallId, discountPercent, tcgplayerUrl, tcgMarketPriceCents, pullProbabilities, possiblePulls, intelReport } = req.body;
  const [product] = await db
    .insert(productsTable)
    .values({
      title,
      shortTitle: shortTitle ?? "",
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
  const { title, shortTitle, subtitle, price, imageUrl, stock, active, specs, contents, expiresAt, scryfallId, discountPercent, tcgplayerUrl, tcgMarketPriceCents, pullProbabilities, possiblePulls, intelReport } = req.body;
  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = title;
  if (shortTitle !== undefined) updates.shortTitle = shortTitle;
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
  // Roll here too, so the admin list never disagrees with the storefront about
  // when the live drop ends.
  res.json(await rollLapsedWindows(products));
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
      const [counts, valueCards, treatments] = await Promise.all([
        fetchRarityCounts(resolved.set.code),
        fetchTopCardsByValue(resolved.set.code),
        fetchSpecialTreatments(resolved.set.code),
      ]);
      const { tiers, perCardByRarity, specials } = computePullData(contents, resolved.slug, counts, treatments);

      // Auto-managed: refresh Possible Pulls to the top chase cards + a sampling
      // of uncommons/commons, with locked per-card odds. Replaces what was stored.
      const possiblePulls = buildPossiblePulls(valueCards, perCardByRarity, specials);

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

// Admin: sync pull probabilities + possible pulls for a SINGLE pack straight from
// Scryfall, without touching any other field. Resolves the Scryfall set from the
// pack's TCGPlayer URL (same matcher as "Look Up" / "Re-lock pull odds"), then
// recomputes tier hit rates + the top chase cards (with images + locked per-card
// odds). Does NOT write to the DB — it returns the computed data so the admin form
// can populate the two editors and the admin reviews before saving. Powers the
// "Sync from Scryfall" button under the Pull Probabilities / Possible Pulls sections.
router.post("/admin/products/sync-pulls", requireAdmin, async (req, res) => {
  const { tcgplayerUrl, contents } = req.body ?? {};
  if (!tcgplayerUrl || typeof tcgplayerUrl !== "string") {
    res.status(422).json({ error: "A TCGPlayer URL is required to resolve the Scryfall set." });
    return;
  }
  try {
    const resolved = await resolveSetFromTcgUrl(tcgplayerUrl);
    if (!resolved) {
      res.status(422).json({ error: "Couldn't match a Scryfall set to that TCGPlayer URL." });
      return;
    }

    const packContents: string[] = Array.isArray(contents) ? contents : [];
    const [counts, valueCards, treatments] = await Promise.all([
      fetchRarityCounts(resolved.set.code),
      fetchTopCardsByValue(resolved.set.code),
      fetchSpecialTreatments(resolved.set.code),
    ]);
    const { tiers, perCardByRarity, specials } = computePullData(packContents, resolved.slug, counts, treatments);
    const possiblePulls = buildPossiblePulls(valueCards, perCardByRarity, specials);

    res.json({
      setCode: resolved.set.code,
      setName: resolved.set.name,
      pullProbabilities: tiers,
      possiblePulls,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Sync failed" });
  }
});

export default router;
