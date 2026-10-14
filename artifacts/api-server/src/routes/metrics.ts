import { Router } from "express";
import Stripe from "stripe";
import { db, ordersTable } from "@workspace/db";
import { requireAdmin } from "../lib/adminAuth";
import {
  classifySource,
  dayKey,
  daysBetween,
  feesByCharge,
  parseMetaInsights,
  parseRange,
  summarizeOrders,
  type FinanceSummary,
  type MetaSummary,
  type OrderExtras,
  type PaidOrder,
  type Range,
} from "../lib/metrics";
import { loadGa4Funnel, type Ga4Summary } from "../lib/ga4";

// GET /api/admin/metrics?range=7d|14d|30d|all
// One payload for the admin Finance and Growth pages. Each source fails on its
// own: a Stripe, Meta or GA4 outage shows as an error on its cards, never a blank page.
// Results are cached in memory for 5 minutes per range.

const router = Router();

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

type Block<T> = ({ ok: true } & T) | { ok: false; error: string };

async function block<T>(load: () => Promise<T>, tag: string): Promise<Block<T>> {
  try {
    return { ok: true, ...(await load()) };
  } catch (err: any) {
    console.error(`[admin/metrics] ${tag} failed:`, err);
    return { ok: false, error: err?.message ?? `${tag} failed` };
  }
}

// ─── Stripe ───────────────────────────────────────────────────────────────────

async function loadStripeOrders(stripe: Stripe, range: Range): Promise<PaidOrder[]> {
  const created = range.start ? { gte: Math.floor(range.start.getTime() / 1000) } : undefined;

  // Fees come from balance transactions, keyed by the charge they belong to.
  // No type filter here: Cash App Pay posts as "payment", cards as "charge".
  const transactions: Stripe.BalanceTransaction[] = [];
  for await (const bt of stripe.balanceTransactions.list({ limit: 100, ...(created ? { created } : {}) })) {
    transactions.push(bt);
  }
  const feeByCharge = feesByCharge(transactions);

  const out: PaidOrder[] = [];
  for await (const s of stripe.checkout.sessions.list({
    status: "complete",
    limit: 100,
    ...(created ? { created } : {}),
    expand: ["data.payment_intent.latest_charge"],
  })) {
    if (s.payment_status !== "paid") continue;
    const pi = typeof s.payment_intent === "object" ? s.payment_intent : null;
    const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    out.push({
      sessionId: s.id,
      created: new Date(s.created * 1000),
      email: s.customer_details?.email ?? "",
      totalCents: s.amount_total ?? 0,
      discountCents: s.total_details?.amount_discount ?? 0,
      refundedCents: charge?.amount_refunded ?? 0,
      feeCents: charge ? feeByCharge.get(charge.id) ?? 0 : 0,
      chargeId: charge?.id ?? null,
    });
  }
  return out;
}

async function loadOrderExtras(): Promise<Map<string, OrderExtras>> {
  const rows = await db
    .select({
      sessionId: ordersTable.stripeSessionId,
      labelCostCents: ordersTable.labelCostCents,
      shippoTransactionId: ordersTable.shippoTransactionId,
      utmSource: ordersTable.utmSource,
      fbclid: ordersTable.fbclid,
      fbc: ordersTable.fbc,
    })
    .from(ordersTable);
  return new Map(
    rows.map((r) => [
      r.sessionId,
      {
        labelCostCents: r.labelCostCents,
        labelBought: !!r.shippoTransactionId && r.shippoTransactionId !== "pending",
        source: classifySource(r),
      },
    ]),
  );
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;

async function graph<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Meta ${res.status}: ${body.error?.message ?? "request failed"}`);
  return body;
}

async function loadMeta(range: Range, days: string[]): Promise<MetaSummary> {
  const token = process.env.META_ACCESS_TOKEN!;
  const account = process.env.META_AD_ACCOUNT_ID || "act_987622110989837";
  const when: Record<string, string> = range.start
    ? { time_range: JSON.stringify({ since: dayKey(range.start), until: dayKey(range.end) }) }
    : { date_preset: "maximum" };

  const [byCampaign, byDay, list] = await Promise.all([
    graph<any>(`${account}/insights`, { level: "campaign", fields: "campaign_id,campaign_name,spend,ctr,actions", limit: "100", ...when }, token),
    graph<any>(`${account}/insights`, { fields: "spend", time_increment: "1", limit: "500", ...when }, token),
    graph<any>(`${account}/campaigns`, { fields: "name,effective_status,stop_time,adsets.limit(50){end_time}", limit: "100" }, token),
  ]);
  return parseMetaInsights(byCampaign, byDay, list, days);
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/admin/metrics", requireAdmin, async (req, res) => {
  const range = parseRange(req.query.range);
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  const orders = await block(async () => {
    if (!stripeKey) throw new Error("Stripe not configured");
    return { list: await cached(`stripe:${range.key}`, () => loadStripeOrders(new Stripe(stripeKey), range)) };
  }, "stripe");

  // "All" starts at the first order (or 30 days back when there are none yet).
  const first = orders.ok && orders.list.length
    ? new Date(Math.min(...orders.list.map((o) => o.created.getTime())))
    : new Date(range.end.getTime() - 29 * 86_400_000);
  const days = daysBetween(range.start ?? first, range.end);

  const finance: Block<FinanceSummary> = orders.ok
    ? await block(async () => summarizeOrders(orders.list, await loadOrderExtras(), days), "orders")
    : orders;

  const meta: Block<MetaSummary> | null = process.env.META_ACCESS_TOKEN
    ? await block(() => cached(`meta:${range.key}`, () => loadMeta(range, days)), "meta")
    : null;

  const ga4: Block<Ga4Summary> | null = process.env.GA4_SERVICE_ACCOUNT_JSON
    ? await block(() => cached(`ga4:${range.key}:${days[0]}`, () => loadGa4Funnel(days)), "ga4")
    : null;

  res.set("Cache-Control", "no-store").json({
    range: { key: range.key, start: range.start?.toISOString() ?? null, end: range.end.toISOString() },
    days,
    generatedAt: new Date().toISOString(),
    finance,
    meta,
    ga4,
  });
});

export default router;
