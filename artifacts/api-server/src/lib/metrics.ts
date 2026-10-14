// Pure helpers for the admin Finance and Growth dashboards (GET /api/admin/metrics).
// Everything here is side-effect free so it can be unit tested; the Stripe, DB
// and Meta calls live in routes/metrics.ts.

export const RANGE_KEYS = ["7d", "14d", "30d", "all"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

// Days are bucketed in the business's own timezone (Palo Alto).
export const BUSINESS_TZ = "America/Los_Angeles";

export type Range = { key: RangeKey; start: Date | null; end: Date };

/** "7d" | "14d" | "30d" | "all" (case-insensitive); anything else falls back to 30d. */
export function parseRange(raw: unknown, now = new Date()): Range {
  const key = (typeof raw === "string" ? raw.toLowerCase() : "") as RangeKey;
  const k: RangeKey = RANGE_KEYS.includes(key) ? key : "30d";
  if (k === "all") return { key: k, start: null, end: now };
  const days = Number(k.replace("d", ""));
  // Start at midnight (business time) days-1 ago, so "7d" is today plus 6 full days.
  const start = startOfBusinessDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  return { key: k, start, end: now };
}

/** YYYY-MM-DD for a date in business time. */
export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** The UTC instant of midnight business time on the same business day as d. */
export function startOfBusinessDay(d: Date): Date {
  const key = dayKey(d);
  // Probe both possible offsets (PST/PDT) and keep the one that lands on the key.
  for (const offset of [7, 8]) {
    const guess = new Date(`${key}T${String(offset).padStart(2, "0")}:00:00Z`);
    if (dayKey(guess) === key && dayKey(new Date(guess.getTime() - 1)) !== key) return guess;
  }
  return new Date(`${key}T08:00:00Z`);
}

/** Every business day from start to end inclusive, as YYYY-MM-DD. Capped at 400 days. */
export function daysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const last = dayKey(end);
  let cur = startOfBusinessDay(start);
  for (let i = 0; i < 400; i++) {
    const k = dayKey(cur);
    out.push(k);
    if (k === last) break;
    cur = new Date(cur.getTime() + 36 * 3_600_000); // next day, safe across DST
    cur = startOfBusinessDay(cur);
  }
  return out;
}

// Our own test orders: the team's addresses. Shown nowhere on the dashboards.
const INTERNAL_EMAIL = /qsbsrollover/i;

export function isInternalEmail(email: string | null | undefined): boolean {
  return !!email && INTERNAL_EMAIL.test(email);
}

/** Cents per cents, or null when the denominator is zero or missing. */
export function ratio(num: number, den: number | null | undefined): number | null {
  return den ? num / den : null;
}

export type Source = "Meta" | "Thank-you card" | "Google" | "Other" | "Direct";

const META_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta"]);

/** Where an order came from, from the attribution columns recorded at checkout. */
export function classifySource(o: {
  utmSource?: string | null;
  fbclid?: string | null;
  fbc?: string | null;
}): Source {
  const src = (o.utmSource ?? "").trim().toLowerCase();
  if (o.fbclid || o.fbc || META_SOURCES.has(src)) return "Meta";
  if (src === "insert") return "Thank-you card";
  if (src === "google") return "Google";
  if (src) return "Other";
  return "Direct";
}

// ─── Orders (from Stripe Checkout Sessions) ──────────────────────────────────

/** One paid Checkout Session, flattened. Amounts in cents. */
export type PaidOrder = {
  sessionId: string;
  created: Date;
  email: string;
  totalCents: number; // what the customer paid
  discountCents: number;
  refundedCents: number;
  feeCents: number;
  chargeId: string | null;
};

export type OrderExtras = {
  labelCostCents: number | null;
  labelBought: boolean;
  source: Source;
};

export type FinanceSummary = {
  grossCents: number; // before discounts and refunds
  discountCents: number;
  refundCents: number;
  netCents: number;
  orders: number;
  avgOrderCents: number | null;
  feeCents: number;
  postageCents: number;
  repeatBuyers: number;
  daily: { date: string; revenueCents: number }[];
  sources: { source: Source; orders: number; revenueCents: number }[];
  recent: {
    ref: string;
    date: string;
    totalCents: number;
    discountCents: number;
    labelBought: boolean;
    source: Source;
  }[];
};

/**
 * Totals for the dashboards. Internal test orders and fully refunded orders are
 * dropped; partial refunds count against net revenue.
 */
export function summarizeOrders(
  orders: PaidOrder[],
  extras: Map<string, OrderExtras>,
  days: string[],
): FinanceSummary {
  const kept = orders.filter(
    (o) => !isInternalEmail(o.email) && !(o.totalCents > 0 && o.refundedCents >= o.totalCents),
  );

  const daily = new Map(days.map((d) => [d, 0]));
  const bySource = new Map<Source, { orders: number; revenueCents: number }>();
  let gross = 0, discount = 0, refund = 0, fee = 0, postage = 0, repeat = 0;

  for (const o of kept) {
    const net = o.totalCents - o.refundedCents;
    const x = extras.get(o.sessionId);
    gross += o.totalCents + o.discountCents;
    discount += o.discountCents;
    refund += o.refundedCents;
    fee += o.feeCents;
    postage += x?.labelCostCents ?? 0;
    if (o.discountCents > 0) repeat++;
    const day = dayKey(o.created);
    if (daily.has(day)) daily.set(day, daily.get(day)! + net);
    const src = x?.source ?? "Direct";
    const s = bySource.get(src) ?? { orders: 0, revenueCents: 0 };
    s.orders++;
    s.revenueCents += net;
    bySource.set(src, s);
  }

  const net = gross - discount - refund;
  return {
    grossCents: gross,
    discountCents: discount,
    refundCents: refund,
    netCents: net,
    orders: kept.length,
    avgOrderCents: kept.length ? Math.round(net / kept.length) : null,
    feeCents: fee,
    postageCents: postage,
    repeatBuyers: repeat,
    daily: [...daily].map(([date, revenueCents]) => ({ date, revenueCents })),
    sources: [...bySource]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
    recent: [...kept]
      .sort((a, b) => b.created.getTime() - a.created.getTime())
      .slice(0, 10)
      .map((o) => ({
        ref: o.sessionId.slice(-8).toUpperCase(),
        date: o.created.toISOString(),
        totalCents: o.totalCents - o.refundedCents,
        discountCents: o.discountCents,
        labelBought: extras.get(o.sessionId)?.labelBought ?? false,
        source: extras.get(o.sessionId)?.source ?? "Direct",
      })),
  };
}

// ─── Meta Marketing API ───────────────────────────────────────────────────────

export type MetaCampaign = {
  id: string;
  name: string;
  status: string; // effective_status, e.g. ACTIVE, PAUSED, COMPLETED
  spendCents: number;
  ctr: number | null; // percent
  purchases: number;
};

export type MetaSummary = {
  spendCents: number;
  daily: { date: string; spendCents: number }[];
  campaigns: MetaCampaign[];
};

type InsightAction = { action_type?: string; value?: string };
type InsightRow = {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  ctr?: string;
  actions?: InsightAction[];
  date_start?: string;
};
type CampaignRow = { id?: string; name?: string; effective_status?: string };

// Meta reports a purchase under several overlapping action types; take the
// first present, in this order, so one sale is never counted twice.
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

export function purchasesFrom(actions: InsightAction[] | undefined): number {
  for (const t of PURCHASE_TYPES) {
    const a = actions?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

const toCents = (s: string | undefined) => Math.round((Number(s) || 0) * 100);

/**
 * Builds the Growth page's Meta block from three Graph API responses:
 * campaign-level insights, account-level daily insights, and the campaign list
 * (for effective_status). Campaigns that are active or spent in range are kept.
 */
export function parseMetaInsights(
  campaignInsights: { data?: InsightRow[] },
  dailyInsights: { data?: InsightRow[] },
  campaignList: { data?: CampaignRow[] },
  days: string[],
): MetaSummary {
  const byId = new Map<string, MetaCampaign>();
  for (const c of campaignList.data ?? []) {
    if (!c.id) continue;
    byId.set(c.id, {
      id: c.id,
      name: c.name ?? "Untitled campaign",
      status: c.effective_status ?? "UNKNOWN",
      spendCents: 0,
      ctr: null,
      purchases: 0,
    });
  }
  for (const r of campaignInsights.data ?? []) {
    if (!r.campaign_id) continue;
    const c = byId.get(r.campaign_id) ?? {
      id: r.campaign_id,
      name: r.campaign_name ?? "Untitled campaign",
      status: "UNKNOWN",
      spendCents: 0,
      ctr: null,
      purchases: 0,
    };
    c.spendCents = toCents(r.spend);
    c.ctr = r.ctr != null && r.ctr !== "" ? Number(r.ctr) : null;
    c.purchases = purchasesFrom(r.actions);
    byId.set(r.campaign_id, c);
  }

  const daily = new Map(days.map((d) => [d, 0]));
  for (const r of dailyInsights.data ?? []) {
    if (r.date_start && daily.has(r.date_start)) {
      daily.set(r.date_start, daily.get(r.date_start)! + toCents(r.spend));
    }
  }

  const campaigns = [...byId.values()]
    .filter((c) => c.status === "ACTIVE" || c.spendCents > 0)
    .sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || b.spendCents - a.spendCents);

  return {
    spendCents: campaigns.reduce((n, c) => n + c.spendCents, 0),
    daily: [...daily].map(([date, spendCents]) => ({ date, spendCents })),
    campaigns,
  };
}
