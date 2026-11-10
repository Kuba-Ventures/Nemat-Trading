import { Router } from "express";
import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAgentKey } from "../lib/agentKey";
import { AGENT_FIELDS, parseAgentUpdate } from "../lib/agentActions";

// Agent routes (x-agent-key). Read products; change only the allow-listed fields, one approved change at a time.
const router = Router();

const view = (p: typeof productsTable.$inferSelect) => ({
  id: p.id, title: p.title, shortTitle: p.shortTitle, subtitle: p.subtitle, price: p.price, stock: p.stock, active: p.active, expiresAt: p.expiresAt,
});

router.get("/agent/products", requireAgentKey, async (_req, res) => {
  const products = await db.select().from(productsTable);
  res.json({ products: products.map(view), editable: AGENT_FIELDS });
});

router.patch("/agent/products/:id", requireAgentKey, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad product id" }); return; }
  const parsed = parseAgentUpdate(req.body);
  if ("error" in parsed) { res.status(400).json(parsed); return; }
  const [before] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!before) { res.status(404).json({ error: "No such product" }); return; }
  const [after] = await db.update(productsTable).set(parsed.updates as any).where(eq(productsTable.id, id)).returning();
  const changed = Object.fromEntries(Object.keys(parsed.updates).map((k) => [k, { from: (before as any)[k], to: (after as any)[k] }]));
  console.info("[agent-action]", JSON.stringify({ at: new Date().toISOString(), productId: id, changed, approval: parsed.approval, reason: parsed.reason }));
  res.json({ product: view(after), changed });
});

export default router;
