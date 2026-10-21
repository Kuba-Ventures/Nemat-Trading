// Live data loaders shared by the admin dashboards (routes/metrics.ts) and the
// weekly snapshot email (lib/weeklySnapshotJob.ts): Stripe orders, order rows
// from the DB, and Meta Marketing API insights.

import Stripe from "stripe";
import { db, ordersTable } from "@workspace/db";
import {
  classifySource,
  dayKey,
  feesByCharge,
  labelState,
  parseMetaInsights,
  parseMetaAds,
  type MetaSummary,
  type OrderExtras,
  type PaidOrder,
  type Range,
} from "./metrics";

export const META_AD_ACCOUNT = () => process.env.META_AD_ACCOUNT_ID || "act_987622110989837";

// ─── Stripe ───────────────────────────────────────────────────────────────────

export async function loadStripeOrders(stripe: Stripe, range: Range): Promise<PaidOrder[]> {
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

export async function loadOrderExtras(): Promise<Map<string, OrderExtras>> {
  const rows = await db
    .select({
      sessionId: ordersTable.stripeSessionId,
      labelCostCents: ordersTable.labelCostCents,
      shippoTransactionId: ordersTable.shippoTransactionId,
      utmSource: ordersTable.utmSource,
      fbclid: ordersTable.fbclid,
      fbc: ordersTable.fbc,
      utmMedium: ordersTable.utmMedium,
      utmCampaign: ordersTable.utmCampaign,
    })
    .from(ordersTable);
  return new Map(
    rows.map((r) => [
      r.sessionId,
      {
        labelCostCents: r.labelCostCents,
        label: labelState(r.shippoTransactionId),
        source: classifySource(r),
        creditedCampaign: r.utmMedium === "manual" ? r.utmCampaign : null,
      },
    ]),
  );
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;

export async function graph<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
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

export async function loadMeta(range: Range, days: string[]): Promise<MetaSummary> {
  const token = process.env.META_ACCESS_TOKEN!;
  const account = META_AD_ACCOUNT();
  const when: Record<string, string> = range.start
    ? { time_range: JSON.stringify({ since: dayKey(range.start), until: dayKey(range.end) }) }
    : { date_preset: "maximum" };

  const [byCampaign, byDay, list, byAd, ads] = await Promise.all([
    graph<any>(`${account}/insights`, { level: "campaign", fields: "campaign_id,campaign_name,spend,ctr,actions", limit: "100", ...when }, token),
    graph<any>(`${account}/insights`, { fields: "spend", time_increment: "1", limit: "500", ...when }, token),
    graph<any>(`${account}/campaigns`, { fields: "name,effective_status,stop_time,adsets.limit(50){end_time}", limit: "100" }, token),
    graph<any>(`${account}/insights`, { level: "ad", fields: "ad_id,spend,impressions,inline_link_clicks,actions", limit: "200", ...when }, token),
    graph<any>(`${account}/ads`, { fields: "name,campaign_id,effective_status,creative{object_type,video_id,asset_feed_spec{videos}}", limit: "200" }, token),
  ]);
  return { ...parseMetaInsights(byCampaign, byDay, list, days), ...parseMetaAds(byAd, ads) };
}
