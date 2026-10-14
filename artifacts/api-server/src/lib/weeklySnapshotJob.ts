// Loads live data for the weekly snapshot email, sends it, and runs the Friday
// schedule. Off unless WEEKLY_SNAPSHOT_TO is set (comma-separated addresses).
//
// The server checks every 10 minutes. Once the Friday 4 PM PT slot has passed,
// the first check claims that week in the weekly_snapshots table and sends, so a
// restart or a second replica never sends twice. Resend's idempotency key is a
// second guard. A failed send releases the claim and is retried on the next check.

import Stripe from "stripe";
import { pool } from "@workspace/db";
import { isInternalEmail, purchasesFrom, summarizeOrders, type Range } from "./metrics";
import { META_AD_ACCOUNT, graph, loadOrderExtras, loadStripeOrders } from "./metricsSources";
import { loadGa4Funnel } from "./ga4";
import {
  buildSnapshotEmail,
  lastSendSlot,
  snapshotWindows,
  type AdRow,
  type AdSetRow,
  type SnapshotData,
  type WeekNumbers,
  type Window,
} from "./weeklySnapshot";

const CHECK_EVERY_MS = 10 * 60 * 1000;
// Don't send a stale snapshot: if the server was down past Saturday 4 PM, skip that week.
const SEND_WITHIN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FROM = "Tommy Top Decker <orders@tommytopdecker.com>";
const DEFAULT_TARGET_CENTS = 4000;

export function snapshotRecipients(raw = process.env.WEEKLY_SNAPSHOT_TO ?? ""): string[] {
  return raw.split(",").map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

const toCents = (s: string | undefined) => Math.round((Number(s) || 0) * 100);

type MetaWeek = { spendCents: number; ctr: number | null; daily: number[]; adSets: AdSetRow[]; ads: AdRow[] };

async function loadMetaWeek(w: Window): Promise<MetaWeek> {
  const token = process.env.META_ACCESS_TOKEN!;
  const account = META_AD_ACCOUNT();
  const when = { time_range: JSON.stringify({ since: w.days[0], until: w.days[w.days.length - 1] }) };
  const [total, byDay, bySet, byAd] = await Promise.all([
    graph<any>(`${account}/insights`, { fields: "spend,ctr", ...when }, token),
    graph<any>(`${account}/insights`, { fields: "spend", time_increment: "1", limit: "50", ...when }, token),
    graph<any>(`${account}/insights`, { level: "adset", fields: "adset_name,spend,actions", limit: "100", ...when }, token),
    graph<any>(`${account}/insights`, { level: "ad", fields: "ad_name,spend,ctr,actions", limit: "200", ...when }, token),
  ]);
  const t = total.data?.[0];
  const daily = new Map(w.days.map((d) => [d, 0]));
  for (const r of byDay.data ?? []) if (daily.has(r.date_start)) daily.set(r.date_start, toCents(r.spend));
  return {
    spendCents: toCents(t?.spend),
    ctr: t?.ctr != null && t.ctr !== "" ? Number(t.ctr) : null,
    daily: [...daily.values()],
    adSets: (bySet.data ?? [])
      .map((r: any) => ({ name: shortName(r.adset_name), spendCents: toCents(r.spend), purchases: purchasesFrom(r.actions) }))
      .filter((a: AdSetRow) => a.spendCents > 0)
      .sort((a: AdSetRow, b: AdSetRow) => b.spendCents - a.spendCents),
    ads: (byAd.data ?? []).map((r: any) => ({
      name: shortName(r.ad_name),
      spendCents: toCents(r.spend),
      ctr: r.ctr != null && r.ctr !== "" ? Number(r.ctr) : null,
      purchases: purchasesFrom(r.actions),
    })),
  };
}

/** "Prospecting - US 18+ Broad - Purchase - $20" reads as "Prospecting"; "Img 5 - Price Drop counter" as "Price Drop counter". */
function shortName(name: string | undefined): string {
  const parts = (name ?? "Untitled").split(" - ").map((s) => s.trim());
  if (parts.length > 1 && /^(img|a)\s?\d+$/i.test(parts[0])) return parts.slice(1).join(" - ");
  return parts[0];
}

async function loadWeek(w: Window, problems: Set<string>): Promise<{ n: WeekNumbers; dailyRevenue: number[]; meta: MetaWeek | null }> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");
  const range: Range = { key: "7d", start: w.start, end: w.end };
  const [orders, extras] = await Promise.all([loadStripeOrders(new Stripe(stripeKey), range), loadOrderExtras()]);
  const inWeek = orders.filter((o) => o.created.getTime() <= w.end.getTime());
  const f = summarizeOrders(inWeek, extras, w.days);

  let meta: MetaWeek | null = null;
  if (process.env.META_ACCESS_TOKEN) {
    meta = await loadMetaWeek(w).catch((err) => {
      console.error("[weekly-snapshot] Meta failed:", err);
      problems.add("Meta ad data unavailable");
      return null;
    });
  }

  let checkoutSessions: number | null = null;
  if (process.env.GA4_SERVICE_ACCOUNT_JSON) {
    checkoutSessions = await loadGa4Funnel(w.days)
      .then((g) => g.steps.find((s) => s.label === "Started checkout")?.sessions ?? null)
      .catch((err) => {
        console.error("[weekly-snapshot] GA4 failed:", err);
        problems.add("Google Analytics unavailable");
        return null;
      });
  }

  return {
    n: {
      revenueCents: f.netCents,
      orders: f.orders,
      feeCents: f.feeCents,
      postageCents: f.postageCents,
      refundCents: f.refundCents,
      discountCents: f.discountCents,
      spendCents: meta ? meta.spendCents : null,
      ctr: meta ? meta.ctr : null,
      checkoutSessions,
    },
    dailyRevenue: f.daily.map((d) => d.revenueCents),
    meta,
  };
}

export async function loadSnapshotData(slot: Date): Promise<SnapshotData> {
  const { week, prior } = snapshotWindows(slot);
  const problems = new Set<string>();
  const [cur, prev] = await Promise.all([loadWeek(week, problems), loadWeek(prior, problems)]);
  const site = (process.env.FRONTEND_URL ?? "https://tommytopdecker.com").split(",")[0].trim().replace(/\/$/, "");
  return {
    week,
    prior,
    thisWeek: cur.n,
    lastWeek: prev.n,
    dailyRevenueCents: cur.dailyRevenue,
    dailySpendCents: cur.meta ? cur.meta.daily : null,
    adSets: cur.meta?.adSets ?? [],
    ads: cur.meta?.ads ?? [],
    targetCostPerSaleCents: Number(process.env.WEEKLY_TARGET_COST_PER_SALE_CENTS) || DEFAULT_TARGET_CENTS,
    dashboardUrl: `${site}/admin`,
    problems: [...problems],
  };
}

/** Sends through Resend. Returns false (never throws) when the send failed. */
export async function sendSnapshot(slot: Date, to: string[], idempotencyKey: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[weekly-snapshot] RESEND_API_KEY not set, skipping");
    return false;
  }
  try {
    const email = buildSnapshotEmail(await loadSnapshotData(slot));
    const replyTo = process.env.WEEKLY_SNAPSHOT_REPLY_TO;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from: process.env.WEEKLY_SNAPSHOT_FROM || process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[weekly-snapshot] Resend ${res.status}: ${await res.text()}`);
      return false;
    }
    console.log(`[weekly-snapshot] sent ${idempotencyKey} to ${to.join(", ")}`);
    return true;
  } catch (err) {
    console.error("[weekly-snapshot] send failed:", err);
    return false;
  }
}

/** One scheduler tick: send this week's snapshot if it's due and not yet claimed. */
export async function runWeeklySnapshot(now = new Date()): Promise<void> {
  const to = snapshotRecipients();
  if (!to.length) return; // off until recipients are configured
  const slot = lastSendSlot(now);
  if (now.getTime() - slot.getTime() > SEND_WITHIN_MS) return;
  const { key } = snapshotWindows(slot);

  const claim = await pool.query(
    "INSERT INTO weekly_snapshots (week) VALUES ($1) ON CONFLICT (week) DO NOTHING RETURNING week",
    [key],
  );
  if (!claim.rowCount) return; // already sent (or being sent) this week

  const ok = await sendSnapshot(slot, to, `weekly-snapshot-${key}`);
  if (ok) {
    await pool.query("UPDATE weekly_snapshots SET recipients = $2, sent_at = NOW() WHERE week = $1", [key, to.join(", ")]);
  } else {
    await pool.query("DELETE FROM weekly_snapshots WHERE week = $1", [key]); // retry next tick
  }
}

let timer: NodeJS.Timeout | null = null;

export function startWeeklySnapshotScheduler(): void {
  if (timer) return;
  const recipients = snapshotRecipients();
  console.log(
    recipients.length
      ? `[weekly-snapshot] on, Fridays 4 PM PT to ${recipients.join(", ")}`
      : "[weekly-snapshot] off (set WEEKLY_SNAPSHOT_TO to turn it on)",
  );
  const tick = () => runWeeklySnapshot().catch((err) => console.error("[weekly-snapshot] tick failed:", err));
  setTimeout(tick, 60_000); // first check a minute after boot
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
}

/** Test sends from the admin page go only to the team's own addresses. */
export function isAllowedTestRecipient(email: string): boolean {
  return isInternalEmail(email) && snapshotRecipients(email).length === 1;
}
