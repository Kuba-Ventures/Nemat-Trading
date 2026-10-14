// Weekly snapshot email: a scorecard of the last 7 days (Friday to Thursday,
// business time) against the 7 before, sent every Friday at 4 PM PT to the
// owner, the client and the team. Pure helpers only, so it can be unit tested;
// loading data and sending live in weeklySnapshotJob.ts.

import { BUSINESS_TZ, dayKey, startOfBusinessDay } from "./metrics";

export const SEND_WEEKDAY = "Fri";
export const SEND_HOUR = 16; // 4 PM business time

const DAY_MS = 86_400_000;

function weekday(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, weekday: "short" }).format(d);
}

/** Midnight business time, `n` days before the business day of `d` (DST safe). */
function midnightDaysBefore(d: Date, n: number): Date {
  // Probe noon of the target day so a DST shift can't land us on the wrong date.
  return startOfBusinessDay(new Date(startOfBusinessDay(d).getTime() - n * DAY_MS + 12 * 3_600_000));
}

/** The most recent Friday 4 PM (business time) at or before `now`. */
export function lastSendSlot(now: Date): Date {
  for (let i = 0; i <= 7; i++) {
    const day = midnightDaysBefore(now, i);
    if (weekday(day) !== SEND_WEEKDAY) continue;
    const slot = new Date(day.getTime() + SEND_HOUR * 3_600_000);
    if (slot.getTime() <= now.getTime()) return slot;
  }
  // Unreachable: some day in the last 8 had a Friday 4 PM in the past.
  return new Date(now.getTime() - 7 * DAY_MS);
}

export type Window = { start: Date; end: Date; days: string[] };

/**
 * The week a send at `slot` reports on: the 7 full business days before the
 * send day (Friday to Thursday), plus the 7 days before that for comparison.
 */
export function snapshotWindows(slot: Date): { week: Window; prior: Window; key: string } {
  const sendDay = startOfBusinessDay(slot);
  const make = (startBack: number, endBack: number): Window => {
    const start = midnightDaysBefore(sendDay, startBack);
    const end = new Date(midnightDaysBefore(sendDay, endBack).getTime() - 1);
    const days: string[] = [];
    for (let i = startBack; i > endBack; i--) days.push(dayKey(midnightDaysBefore(sendDay, i)));
    return { start, end, days };
  };
  return { week: make(7, 0), prior: make(14, 7), key: dayKey(slot) };
}

// ─── Data the email shows ─────────────────────────────────────────────────────

export type WeekNumbers = {
  revenueCents: number; // net of discounts and refunds
  orders: number;
  feeCents: number;
  postageCents: number;
  refundCents: number;
  discountCents: number;
  spendCents: number | null; // null when Meta is not connected or failed
  ctr: number | null; // percent, all clicks
  checkoutSessions: number | null; // GA4 sessions that started checkout
};

export type AdSetRow = { name: string; spendCents: number; purchases: number };
export type AdRow = { name: string; spendCents: number; ctr: number | null; purchases: number };

export type SnapshotData = {
  week: Window;
  prior: Window;
  thisWeek: WeekNumbers;
  lastWeek: WeekNumbers;
  dailyRevenueCents: number[]; // one per week.days
  dailySpendCents: number[] | null;
  adSets: AdSetRow[];
  ads: AdRow[];
  targetCostPerSaleCents: number;
  dashboardUrl: string;
  problems: string[]; // sources that failed, e.g. "Meta unavailable"
};

// ─── Derived numbers ──────────────────────────────────────────────────────────

export function costPerSale(w: WeekNumbers): number | null {
  if (w.spendCents == null || w.orders === 0) return null;
  return Math.round(w.spendCents / w.orders);
}

/** Orders as a share of sessions that started checkout, in percent. */
export function checkoutRate(w: WeekNumbers): number | null {
  if (!w.checkoutSessions) return null;
  return Math.min(100, (w.orders / w.checkoutSessions) * 100);
}

/** What's left after Stripe fees, postage and ad spend, before product cost. */
export function keptCents(w: WeekNumbers): number {
  return w.revenueCents - w.feeCents - w.postageCents - (w.spendCents ?? 0);
}

/** The best ad: most purchases, then highest click rate, among ads that spent $5+. */
export function bestAd(ads: AdRow[]): AdRow | null {
  const eligible = ads.filter((a) => a.spendCents >= 500);
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => b.purchases - a.purchases || (b.ctr ?? 0) - (a.ctr ?? 0))[0];
}

export type Tone = "good" | "bad" | "neutral";
export type Chip = { label: string; tone: Tone };

export function costChip(w: WeekNumbers, targetCents: number): Chip {
  if (w.spendCents == null) return { label: "No ad data", tone: "neutral" };
  if (w.spendCents === 0) return { label: "No spend", tone: "neutral" };
  const cps = costPerSale(w);
  if (cps == null) return { label: "No sales", tone: "bad" };
  return cps <= targetCents ? { label: "On target", tone: "good" } : { label: "Off target", tone: "bad" };
}

export function ctrChip(ctr: number | null): Chip {
  if (ctr == null) return { label: "No ad data", tone: "neutral" };
  if (ctr >= 2) return { label: "Strong", tone: "good" };
  if (ctr < 1) return { label: "Weak", tone: "bad" };
  return { label: "Average", tone: "neutral" };
}

export function checkoutChip(rate: number | null): Chip {
  if (rate == null) return { label: "No data", tone: "neutral" };
  if (rate >= 40) return { label: "Strong", tone: "good" };
  if (rate < 20) return { label: "Weak", tone: "bad" };
  return { label: "Average", tone: "neutral" };
}

/** Up / Down / Flat against last week; `higherIsBetter` picks the color. */
export function trendChip(now: number | null, before: number | null, higherIsBetter = true): Chip {
  if (now == null || before == null || now === before) return { label: "Flat", tone: "neutral" };
  const up = now > before;
  return { label: up ? "Up" : "Down", tone: up === higherIsBetter ? "good" : "bad" };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const pct = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}%`;

export function shortDay(key: string): string {
  // key is YYYY-MM-DD; build at noon UTC so the label can't slip a day.
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function weekdayLabel(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function rangeLabel(w: Window): string {
  return `${shortDay(w.days[0])} to ${shortDay(w.days[w.days.length - 1])}`;
}

/** "▲ $12.00", "▼ 1.2 pts", "new" (nothing to compare), "no change". */
export function changeLabel(now: number | null, before: number | null, kind: "money" | "count" | "pct"): string {
  if (now == null) return "-";
  if (before == null) return "new";
  const d = now - before;
  if (Math.abs(d) < (kind === "pct" ? 0.05 : 0.5)) return "no change";
  const arrow = d > 0 ? "▲" : "▼";
  const v = Math.abs(d);
  if (kind === "money") return `${arrow} ${money(v)}`;
  if (kind === "pct") return `${arrow} ${v.toFixed(1)} pts`;
  return `${arrow} ${Math.round(v)}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Email ────────────────────────────────────────────────────────────────────

const CHIP_STYLE: Record<Tone, string> = {
  good: "background:#e7f6ec;color:#15803d",
  bad: "background:#fdecec;color:#b42318",
  neutral: "background:#f3f4f6;color:#374151",
};
const CHANGE_COLOR: Record<Tone, string> = { good: "#15803d", bad: "#b42318", neutral: "#6b7280" };
const SPEND_COLOR = "#d4a017";
const REVENUE_COLOR = "#0891b2";

// better: which direction of change is good news ("up"), bad news ("down"), or neither ("none").
type ScoreRow = { metric: string; note?: string; value: string; valueBad?: boolean; change: string; better: "up" | "down" | "none"; chip: Chip };

export function scoreRows(d: SnapshotData): ScoreRow[] {
  const t = d.thisWeek;
  const l = d.lastWeek;
  const cps = costPerSale(t);
  const cpsBefore = costPerSale(l);
  const rate = checkoutRate(t);
  const kept = keptCents(t);
  const keptBefore = keptCents(l);
  const spendTrend = trendChip(t.spendCents, l.spendCents, true);
  return [
    { metric: "Revenue", value: money(t.revenueCents), change: changeLabel(t.revenueCents, l.revenueCents, "money"), better: "up", chip: trendChip(t.revenueCents, l.revenueCents) },
    { metric: "Orders", value: String(t.orders), change: changeLabel(t.orders, l.orders, "count"), better: "up", chip: trendChip(t.orders, l.orders) },
    {
      metric: "Ad spend",
      value: t.spendCents == null ? "-" : money(t.spendCents),
      change: changeLabel(t.spendCents, l.spendCents, "money"),
      better: "none",
      chip: { label: spendTrend.label, tone: "neutral" }, // more spend is neither good nor bad on its own
    },
    {
      metric: "Cost per sale",
      note: `target ${money(d.targetCostPerSaleCents).replace(".00", "")}`,
      value: cps == null ? "-" : money(cps),
      valueBad: cps != null && cps > d.targetCostPerSaleCents,
      change: cps == null ? "-" : changeLabel(cps, cpsBefore, "money"),
      better: "down",
      chip: costChip(t, d.targetCostPerSaleCents),
    },
    { metric: "Click rate", value: t.ctr == null ? "-" : pct(t.ctr), change: changeLabel(t.ctr, l.ctr, "pct"), better: "up", chip: ctrChip(t.ctr) },
    { metric: "Checkout to purchase", value: rate == null ? "-" : pct(rate), change: changeLabel(rate, checkoutRate(l), "pct"), better: "up", chip: checkoutChip(rate) },
    {
      metric: "Kept, before product cost",
      value: money(kept),
      valueBad: kept < 0,
      change: changeLabel(kept, keptBefore, "money"),
      better: "up",
      chip: kept >= 0 ? { label: "Positive", tone: "good" } : { label: "Negative", tone: "bad" },
    },
  ];
}

/** Tone for the change column: green when it moved the good way, red the bad way. */
export function changeTone(row: Pick<ScoreRow, "change" | "better">): Tone {
  const up = row.change.startsWith("▲");
  if (row.better === "none" || (!up && !row.change.startsWith("▼"))) return "neutral";
  return up === (row.better === "up") ? "good" : "bad";
}

function bars(d: SnapshotData): string {
  const spend = d.dailySpendCents ?? d.week.days.map(() => 0);
  const max = Math.max(1, ...spend, ...d.dailyRevenueCents);
  const h = (v: number) => Math.round((v / max) * 80);
  const cells = d.week.days
    .map((day, i) => {
      const s = h(spend[i] ?? 0);
      const r = h(d.dailyRevenueCents[i] ?? 0);
      return (
        `<td width="14%" align="center" valign="bottom" style="height:84px">` +
        (s ? `<div style="display:inline-block;width:10px;height:${s}px;background:${SPEND_COLOR}"></div>` : "") +
        (s && r ? " " : "") +
        (r ? `<div style="display:inline-block;width:10px;height:${r}px;background:${REVENUE_COLOR}"></div>` : "") +
        `</td>`
      );
    })
    .join("");
  const labels = d.week.days
    .map((day) => `<td width="14%" align="center" style="font-size:10px;color:#9ca3af;padding-top:4px">${weekdayLabel(day)}</td>`)
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr><tr>${labels}</tr></table>`;
}

export function buildSnapshotEmail(d: SnapshotData): { subject: string; html: string; text: string } {
  const t = d.thisWeek;
  const week = rangeLabel(d.week);
  const prior = rangeLabel(d.prior);
  const rows = scoreRows(d);
  const best = bestAd(d.ads);
  const subject = `Tommy Top Decker weekly scorecard: ${week}`;

  const row = (r: ScoreRow) =>
    `<tr>` +
    `<td style="padding:10px 0;border-bottom:1px solid #eeeeee">${esc(r.metric)}${r.note ? ` <span style="color:#6b7280;font-size:12px">(${esc(r.note)})</span>` : ""}</td>` +
    `<td align="right" style="border-bottom:1px solid #eeeeee;font-weight:700;${r.valueBad ? "color:#b42318" : ""}">${esc(r.value)}</td>` +
    `<td align="right" style="border-bottom:1px solid #eeeeee;color:${CHANGE_COLOR[changeTone(r)]}">${esc(r.change)}</td>` +
    `<td align="right" style="border-bottom:1px solid #eeeeee"><span style="${CHIP_STYLE[r.chip.tone]};font-size:11px;padding:3px 8px;border-radius:10px;white-space:nowrap">${esc(r.chip.label)}</span></td>` +
    `</tr>`;

  const adSetLines = d.adSets.length
    ? d.adSets.map((a) => `${esc(a.name)}: ${money(a.spendCents)}, ${a.purchases} ${a.purchases === 1 ? "sale" : "sales"}`).join("<br>")
    : d.dailySpendCents == null ? "Meta data unavailable" : "No ad spend this week";
  const bestLine = best
    ? `<br>Best ad: ${esc(best.name)}${best.ctr != null ? ` (${pct(best.ctr)} click rate)` : ""}`
    : "";

  const label = (s: string) => `<div style="font-size:10px;letter-spacing:.14em;color:#6b7280;font-weight:700;margin-bottom:6px">${s}</div>`;

  const html = [
    `<div style="margin:0;background:#f4f0e8">`,
    `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f0e8" style="background:#f4f0e8"><tr><td align="center" style="padding:20px 0">`,
    `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#111111">`,
    `<tr><td bgcolor="#000000" style="background:#000000;padding:22px 24px"><table width="100%" cellpadding="0" cellspacing="0"><tr>`,
    `<td><span style="display:block;font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.16em;color:#f4f0e8">TOMMYTOPDECKER</span>`,
    `<span style="display:block;font-family:'Arial Black',Impact,Helvetica,sans-serif;font-weight:900;font-size:22px;text-transform:uppercase;color:#ffffff;margin-top:8px">Weekly scorecard</span></td>`,
    `<td align="right" valign="bottom" style="font-size:12px;color:#9ca3af">${esc(week)}<br>vs. ${esc(prior)}</td>`,
    `</tr></table></td></tr>`,
    `<tr><td style="padding:10px 24px 0;font-size:12px;color:#6b7280">Test orders excluded.${d.problems.length ? ` <span style="color:#b42318">${esc(d.problems.join(". "))}.</span>` : ""}</td></tr>`,
    `<tr><td style="padding:14px 24px 0"><table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">`,
    `<tr style="font-size:10px;letter-spacing:.12em;color:#6b7280">`,
    `<td style="padding:6px 0;border-bottom:2px solid #111111">METRIC</td>`,
    `<td align="right" style="padding:6px 0;border-bottom:2px solid #111111">THIS WEEK</td>`,
    `<td align="right" style="padding:6px 0;border-bottom:2px solid #111111">VS LAST WEEK</td>`,
    `<td align="right" style="padding:6px 0;border-bottom:2px solid #111111">STATUS</td></tr>`,
    ...rows.map(row),
    `</table></td></tr>`,
    `<tr><td style="padding:22px 24px 8px;font-size:10px;letter-spacing:.14em;color:#6b7280;font-weight:700">AD SPEND <span style="color:${SPEND_COLOR}">&#9632;</span> VS REVENUE <span style="color:${REVENUE_COLOR}">&#9632;</span>, BY DAY</td></tr>`,
    `<tr><td style="padding:0 24px">${bars(d)}</td></tr>`,
    `<tr><td style="padding:22px 24px 0"><table width="100%" cellpadding="0" cellspacing="0"><tr valign="top">`,
    `<td width="55%" style="padding-right:10px;font-size:13px;line-height:1.6">${label("CAMPAIGN")}${adSetLines}${bestLine}</td>`,
    `<td width="45%" style="padding-left:10px;font-size:13px;line-height:1.6">${label("MONEY")}`,
    `Stripe fees: ${money(t.feeCents)}<br>Postage: ${money(t.postageCents)}<br>Discounts: ${money(t.discountCents)}<br>Refunds: ${money(t.refundCents)}</td>`,
    `</tr></table></td></tr>`,
    `<tr><td align="center" style="padding:26px 0 12px"><a href="${esc(d.dashboardUrl)}" style="display:inline-block;background:#000000;color:#ffffff;font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.25em;padding:12px 30px;border-radius:4px;text-decoration:none">OPEN DASHBOARD</a></td></tr>`,
    `<tr><td align="center" style="padding:0 24px 26px;font-size:11px;color:#9ca3af">Sent every Friday at 4 PM PT. Live numbers anytime on the dashboard.</td></tr>`,
    `</table></td></tr></table></div>`,
  ].join("");

  const text = [
    `Tommy Top Decker weekly scorecard`,
    `${week} (vs. ${prior}). Test orders excluded.`,
    ...(d.problems.length ? [d.problems.join(". ") + "."] : []),
    ``,
    ...rows.map((r) => `${r.metric}${r.note ? ` (${r.note})` : ""}: ${r.value} (${r.change}, ${r.chip.label})`),
    ``,
    `Campaign:`,
    ...(d.adSets.length ? d.adSets.map((a) => `- ${a.name}: ${money(a.spendCents)}, ${a.purchases} ${a.purchases === 1 ? "sale" : "sales"}`) : ["- No ad spend this week"]),
    ...(best ? [`- Best ad: ${best.name}`] : []),
    ``,
    `Money: Stripe fees ${money(t.feeCents)}, postage ${money(t.postageCents)}, discounts ${money(t.discountCents)}, refunds ${money(t.refundCents)}.`,
    ``,
    `Dashboard: ${d.dashboardUrl}`,
  ].join("\n");

  return { subject, html, text };
}
