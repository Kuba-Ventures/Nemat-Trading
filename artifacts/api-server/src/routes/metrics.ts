import { Router } from "express";
import Stripe from "stripe";
import { requireAdmin } from "../lib/adminAuth";
import { createSyncCache } from "../lib/syncCache";
import {
  daysBetween,
  withCreditedSales,
  parseRange,
  summarizeOrders,
  type FinanceSummary,
  type MetaSummary,
} from "../lib/metrics";
import { loadOrderExtras, loadMeta, loadStripeOrders } from "../lib/metricsSources";
import { loadGa4Funnel, type Ga4Summary } from "../lib/ga4";

// GET /api/admin/metrics?range=7d|14d|30d|all
// One payload for the admin Finance and Growth pages. Each source fails on its
// own: a Stripe, Meta or GA4 outage shows as an error on its cards, never a blank page.
// Each source is cached in memory for 1 minute per range, and the response says
// when each one was fetched. ?fresh=1 ("Sync now") skips the cache.

const router = Router();

const cached = createSyncCache(60 * 1000, 10 * 1000);

type Block<T> = ({ ok: true } & T) | { ok: false; error: string };

async function block<T>(load: () => Promise<T>, tag: string): Promise<Block<T>> {
  try {
    return { ok: true, ...(await load()) };
  } catch (err: any) {
    console.error(`[admin/metrics] ${tag} failed:`, err);
    return { ok: false, error: err?.message ?? `${tag} failed` };
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/admin/metrics", requireAdmin, async (req, res) => {
  const range = parseRange(req.query.range);
  const fresh = req.query.fresh === "1";
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  // When each source was last fetched (null: not configured or it failed).
  const synced: { stripe: string | null; meta: string | null; ga4: string | null } = { stripe: null, meta: null, ga4: null };
  const track = async <T>(source: keyof typeof synced, key: string, load: () => Promise<T>): Promise<T> => {
    const hit = await cached(key, load, fresh);
    synced[source] = new Date(hit.at).toISOString();
    return hit.value;
  };

  const orders = await block(async () => {
    if (!stripeKey) throw new Error("Stripe not configured");
    return { list: await track("stripe", `stripe:${range.key}`, () => loadStripeOrders(new Stripe(stripeKey), range)) };
  }, "stripe");

  // "All" starts at the first order (or 30 days back when there are none yet).
  const first = orders.ok && orders.list.length
    ? new Date(Math.min(...orders.list.map((o) => o.created.getTime())))
    : new Date(range.end.getTime() - 29 * 86_400_000);
  const days = daysBetween(range.start ?? first, range.end);

  const extras = await loadOrderExtras().catch((err) => {
    console.error("[admin/metrics] orders failed:", err);
    return err as Error;
  });

  const finance: Block<FinanceSummary> = !orders.ok
    ? orders
    : extras instanceof Error
      ? { ok: false, error: extras.message || "orders failed" }
      : await block(async () => summarizeOrders(orders.list, extras, days), "orders");

  // Campaign sales add orders credited by hand to what Meta tracked.
  const meta: Block<MetaSummary> | null = process.env.META_ACCESS_TOKEN
    ? await block(async () => {
        const m = await track("meta", `meta:${range.key}`, () => loadMeta(range, days));
        return orders.ok && !(extras instanceof Error)
          ? { ...m, campaigns: withCreditedSales(m.campaigns, orders.list, extras) }
          : m;
      }, "meta")
    : null;

  const ga4: Block<Ga4Summary> | null = process.env.GA4_SERVICE_ACCOUNT_JSON
    ? await block(() => track("ga4", `ga4:${range.key}:${days[0]}`, () => loadGa4Funnel(days)), "ga4")
    : null;

  res.set("Cache-Control", "no-store").json({
    range: { key: range.key, start: range.start?.toISOString() ?? null, end: range.end.toISOString() },
    days,
    generatedAt: new Date().toISOString(),
    synced,
    finance,
    meta,
    ga4,
  });
});

export default router;
