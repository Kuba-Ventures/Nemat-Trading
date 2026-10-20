// Loads live Meta data for the internal ads check, sends it, and runs the
// schedule. Off unless META_ADS_CHECK_TO is set; only team (qsbsrollover.com)
// addresses are kept, so the client never gets it.
//
// The server checks every 10 minutes. Once a check day's 9 AM PT slot has passed,
// the first check claims that day in the weekly_snapshots table (key
// "meta-check-YYYY-MM-DD") and sends, so a restart or a second replica never sends
// twice. A failed send releases the claim and is retried on the next check.

import { pool } from "@workspace/db";
import { dayKey, purchasesFrom } from "./metrics";
import { META_AD_ACCOUNT, graph } from "./metricsSources";
import {
  buildCheckEmail,
  checkRecipients,
  dueCheck,
  isCampaignRunning,
  type CheckAd,
  type CheckAdSet,
  type CheckData,
  type CheckKind,
} from "./metaAdsCheck";

const CHECK_EVERY_MS = 10 * 60 * 1000;
const DEFAULT_FROM = "Tommy Top Decker <orders@tommytopdecker.com>";
const DEFAULT_TARGET_CENTS = 4000;

const toCents = (s: string | undefined) => Math.round((Number(s) || 0) * 100);
const optNumber = (s: string | undefined) => (s == null || s === "" || !Number.isFinite(Number(s)) ? null : Number(s));

type List<T> = { data?: T[] };

export async function loadCheckRows(): Promise<{ adSets: CheckAdSet[]; ads: CheckAd[] }> {
  const token = process.env.META_ACCESS_TOKEN!;
  const account = META_AD_ACCOUNT();
  const fields = "adset_id,spend,impressions,ctr,frequency,actions";
  const [sets, lifetime, week, ads, adWeek] = await Promise.all([
    graph<List<any>>(`${account}/adsets`, { fields: "id,name,effective_status,daily_budget", limit: "200" }, token),
    graph<List<any>>(`${account}/insights`, { level: "adset", date_preset: "maximum", fields, limit: "200" }, token),
    graph<List<any>>(`${account}/insights`, { level: "adset", date_preset: "last_7d", fields, limit: "200" }, token),
    graph<List<any>>(`${account}/ads`, { fields: "id,name,effective_status,adset{name},ad_review_feedback", limit: "200" }, token),
    graph<List<any>>(`${account}/insights`, { level: "ad", date_preset: "last_7d", fields: "ad_id,spend,ctr,actions", limit: "200" }, token),
  ]);
  const life = new Map((lifetime.data ?? []).map((r) => [r.adset_id, r]));
  const last = new Map((week.data ?? []).map((r) => [r.adset_id, r]));
  const adLast = new Map((adWeek.data ?? []).map((r) => [r.ad_id, r]));
  return {
    adSets: (sets.data ?? []).map((s) => {
      const l = life.get(s.id);
      const w = last.get(s.id);
      return {
        name: s.name ?? "Unnamed ad set",
        status: s.effective_status ?? "UNKNOWN",
        dailyBudgetCents: s.daily_budget ? Number(s.daily_budget) : null,
        lifetimeSpendCents: toCents(l?.spend),
        lifetimeSales: purchasesFrom(l?.actions),
        spend7dCents: toCents(w?.spend),
        impressions7d: Number(w?.impressions ?? 0),
        ctr7d: optNumber(w?.ctr),
        frequency7d: optNumber(w?.frequency),
      };
    }),
    ads: (ads.data ?? []).map((a) => {
      const w = adLast.get(a.id);
      const feedback = Object.keys(a.ad_review_feedback?.global ?? {}).join(", ");
      return {
        name: a.name ?? "Unnamed ad",
        adSetName: a.adset?.name ?? "an unnamed ad set",
        status: a.effective_status ?? "UNKNOWN",
        reviewFeedback: feedback || null,
        spend7dCents: toCents(w?.spend),
        ctr7d: optNumber(w?.ctr),
        sales7d: purchasesFrom(w?.actions),
      };
    }),
  };
}

export async function loadCheckData(kind: CheckKind, now = new Date()): Promise<CheckData> {
  const { adSets, ads } = await loadCheckRows();
  return {
    kind,
    day: dayKey(now),
    adSets,
    ads,
    targetCostPerSaleCents: Number(process.env.WEEKLY_TARGET_COST_PER_SALE_CENTS) || DEFAULT_TARGET_CENTS,
  };
}

/** Sends through Resend. Returns false (never throws) when the send failed. */
export async function sendCheck(d: CheckData, to: string[], idempotencyKey: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[meta-ads-check] RESEND_API_KEY not set, skipping");
    return false;
  }
  try {
    const email = buildCheckEmail(d);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from: process.env.WEEKLY_SNAPSHOT_FROM || process.env.ORDER_EMAIL_FROM || DEFAULT_FROM,
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[meta-ads-check] Resend ${res.status}: ${await res.text()}`);
      return false;
    }
    console.log(`[meta-ads-check] sent ${idempotencyKey} to ${to.join(", ")}`);
    return true;
  } catch (err) {
    console.error("[meta-ads-check] send failed:", err);
    return false;
  }
}

export type CheckOutcome = "off" | "not_due" | "already_sent" | "campaign_not_running" | "sent" | "send_failed";

/** One scheduler tick: send today's check if it's due and not yet claimed. */
export async function runMetaAdsCheck(now = new Date()): Promise<CheckOutcome> {
  const to = checkRecipients();
  if (!to.length || !process.env.META_ACCESS_TOKEN) return "off";
  const kind = dueCheck(now);
  if (!kind) return "not_due";
  const key = `meta-check-${dayKey(now)}`;

  const claim = await pool.query(
    "INSERT INTO weekly_snapshots (week) VALUES ($1) ON CONFLICT (week) DO NOTHING RETURNING week",
    [key],
  );
  if (!claim.rowCount) return "already_sent";

  let outcome: CheckOutcome;
  try {
    const d = await loadCheckData(kind, now);
    if (kind === "weekly" && !isCampaignRunning(d.adSets)) {
      outcome = "campaign_not_running"; // keep the claim: nothing to send today
    } else {
      outcome = (await sendCheck(d, to, key)) ? "sent" : "send_failed";
    }
  } catch (err) {
    console.error("[meta-ads-check] load failed:", err);
    outcome = "send_failed";
  }
  if (outcome === "sent") {
    await pool.query("UPDATE weekly_snapshots SET recipients = $2, sent_at = NOW() WHERE week = $1", [key, to.join(", ")]);
  } else if (outcome === "send_failed") {
    await pool.query("DELETE FROM weekly_snapshots WHERE week = $1", [key]); // retry next tick
  }
  return outcome;
}

let timer: NodeJS.Timeout | null = null;

export function startMetaAdsCheckScheduler(): void {
  if (timer) return;
  const to = checkRecipients();
  console.log(
    to.length
      ? `[meta-ads-check] on, 9 AM PT on check days to ${to.join(", ")}`
      : "[meta-ads-check] off (set META_ADS_CHECK_TO to a team address to turn it on)",
  );
  const tick = () => runMetaAdsCheck().catch((err) => console.error("[meta-ads-check] tick failed:", err));
  setTimeout(tick, 90_000); // first check shortly after boot, after the scorecard's
  timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
}
