// Internal Meta ads check: which ad sets and ads are earning sales, and what to
// do about the ones that aren't. Goes to the team only (never the client) at
// 9 AM PT on the Reel test's check days and every Monday while the campaign runs.
// Pure helpers only, so it can be unit tested; loading and sending live in
// metaAdsCheckJob.ts. Ported from Telly's weekly check, with sales for leads.

import { BUSINESS_TZ, dayKey, isInternalEmail, startOfBusinessDay } from "./metrics";
import { esc, money, shortDay } from "./weeklySnapshot";

export type CheckKind = "day_one" | "day_three" | "weekly" | "review";

export const SEND_HOUR = 9; // 9 AM business time
export const PAUSE_SPEND_WITHOUT_SALES_CENTS = 8000; // twice the $40 cost per sale target
export const TIRED_FREQUENCY = 3;
export const ADS_MANAGER_URL =
  "https://adsmanager.facebook.com/adsmanager/manage/adsets?act=987622110989837&business_id=2000673880800829";

// The Reels went live Oct 20 2026; the relaunch campaign ends Oct 29.
const ONE_OFF_DAYS: Record<string, CheckKind> = {
  "2026-10-21": "day_one",
  "2026-10-23": "day_three",
  "2026-10-28": "review",
};
const FIRST_WEEKLY_DAY = "2026-10-26";

const TITLE: Record<CheckKind, string> = {
  day_one: "Reels day 1 check",
  day_three: "Reels day 3 check",
  weekly: "Weekly check",
  review: "Relaunch review",
};

const QUESTION: Record<CheckKind, string> = {
  day_one: "Are both Reels spending, and was any ad rejected?",
  day_three: "Are the Reels earning clicks and sales next to the images?",
  weekly: "Which ad sets are earning sales, and which should stop?",
  review: "Keep, pause or move budget before the campaign ends Oct 29?",
};

export function checkKindForDay(key: string, weekday: string): CheckKind | null {
  if (ONE_OFF_DAYS[key]) return ONE_OFF_DAYS[key];
  if (weekday === "Mon" && key >= FIRST_WEEKLY_DAY) return "weekly";
  return null;
}

function weekday(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, weekday: "short" }).format(d);
}

/** Today's check, if today is a check day and its 9 AM business-time slot has passed. */
export function dueCheck(now: Date): CheckKind | null {
  const kind = checkKindForDay(dayKey(now), weekday(now));
  if (!kind) return null;
  const slot = startOfBusinessDay(now).getTime() + SEND_HOUR * 3_600_000;
  return now.getTime() >= slot ? kind : null;
}

/** Comma-separated addresses, team (qsbsrollover.com) only, so the client never gets it. */
export function checkRecipients(raw = process.env.META_ADS_CHECK_TO ?? ""): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && isInternalEmail(s));
}

// ─── Data the email shows ─────────────────────────────────────────────────────

export type CheckAdSet = {
  name: string;
  status: string; // Meta effective_status
  dailyBudgetCents: number | null;
  lifetimeSpendCents: number;
  lifetimeSales: number;
  spend7dCents: number;
  impressions7d: number;
  ctr7d: number | null; // percent
  frequency7d: number | null;
};

export type CheckAd = {
  name: string;
  adSetName: string;
  status: string;
  reviewFeedback: string | null;
  spend7dCents: number;
  ctr7d: number | null;
  sales7d: number;
};

export type CheckData = {
  kind: CheckKind;
  day: string; // YYYY-MM-DD business time
  adSets: CheckAdSet[];
  ads: CheckAd[];
  targetCostPerSaleCents: number;
};

type Tone = "good" | "bad" | "neutral";
export type Verdict = { label: string; tone: Tone; action: string | null };

export const isOn = (s: { status: string }) => s.status === "ACTIVE";

export function costPerSale(a: CheckAdSet): number | null {
  return a.lifetimeSales > 0 ? Math.round(a.lifetimeSpendCents / a.lifetimeSales) : null;
}

export function adSetVerdict(a: CheckAdSet, targetCents: number): Verdict {
  const cps = costPerSale(a);
  if (a.lifetimeSales === 0 && a.lifetimeSpendCents >= PAUSE_SPEND_WITHOUT_SALES_CENTS) {
    return { label: "Pause", tone: "bad", action: `Pause ${a.name}: ${money(a.lifetimeSpendCents)} spent with no sales.` };
  }
  if (isOn(a) && a.impressions7d === 0) {
    return { label: "Not spending", tone: "bad", action: `${a.name} is on but nobody has seen it. Check its ads and audience.` };
  }
  if (a.frequency7d != null && a.frequency7d > TIRED_FREQUENCY) {
    return {
      label: "Needs a new ad",
      tone: "bad",
      action: `${a.name}: people have seen the same ads ${a.frequency7d.toFixed(1)} times. Swap in a new one.`,
    };
  }
  if (cps != null && cps > targetCents) {
    return {
      label: `Over ${money(targetCents).replace(".00", "")} a sale`,
      tone: "bad",
      action: `${a.name} costs ${money(cps)} a sale. Move budget away unless it's improving.`,
    };
  }
  if (cps != null) return { label: "Keep", tone: "good", action: null };
  return { label: "Too early", tone: "neutral", action: null };
}

export const hasProblem = (ad: CheckAd) => ad.status === "DISAPPROVED" || ad.status === "WITH_ISSUES";

/** Ad sets that are on or spent this week, biggest spend first. Finished campaigns drop out. */
export function reportedAdSets(adSets: CheckAdSet[]): CheckAdSet[] {
  return adSets
    .filter((a) => isOn(a) || a.spend7dCents > 0)
    .sort((a, b) => b.lifetimeSpendCents - a.lifetimeSpendCents);
}

export function reportedAds(ads: CheckAd[]): CheckAd[] {
  return ads.filter((a) => isOn(a) || a.spend7dCents > 0 || hasProblem(a)).sort((a, b) => b.spend7dCents - a.spend7dCents);
}

export function isCampaignRunning(adSets: CheckAdSet[]): boolean {
  return adSets.some((a) => isOn(a) || a.spend7dCents > 0);
}

export function checkActions(d: CheckData): string[] {
  const adProblems = d.ads
    .filter(hasProblem)
    .map(
      (ad) =>
        `Ad "${ad.name}" in ${ad.adSetName} is ${ad.status === "DISAPPROVED" ? "rejected" : "flagged"}${
          ad.reviewFeedback ? `: ${ad.reviewFeedback}` : ""
        }. Fix it or replace it.`,
    );
  const notDelivering =
    d.kind === "day_one"
      ? d.ads
          .filter((ad) => isOn(ad) && ad.spend7dCents === 0 && /^reel\b/i.test(ad.name))
          .map((ad) => `${ad.name} hasn't spent yet. Check it cleared review.`)
      : [];
  const adSetActions = reportedAdSets(d.adSets)
    .map((a) => adSetVerdict(a, d.targetCostPerSaleCents).action)
    .filter((a): a is string => a != null);
  const review =
    d.kind === "review"
      ? ["Decide with Shawn: extend the campaign past Oct 29, move budget to what's working, or stop."]
      : [];
  return [...adProblems, ...notDelivering, ...adSetActions, ...review];
}

// ─── Email ────────────────────────────────────────────────────────────────────

const pct = (v: number | null) => (v == null ? "-" : `${v.toFixed(1)}%`);
const optMoney = (c: number | null) => (c == null ? "-" : money(c));
const sales = (n: number) => `${n} ${n === 1 ? "sale" : "sales"}`;

const CHIP_STYLE: Record<Tone, string> = {
  good: "background:#e7f6ec;color:#15803d",
  bad: "background:#fdecec;color:#b42318",
  neutral: "background:#f3f4f6;color:#374151",
};

export function buildCheckEmail(d: CheckData): { subject: string; html: string; text: string } {
  const title = TITLE[d.kind];
  const question = QUESTION[d.kind];
  const adSets = reportedAdSets(d.adSets);
  const ads = reportedAds(d.ads);
  const actions = checkActions(d);
  const spent = adSets.reduce((n, a) => n + a.lifetimeSpendCents, 0);
  const sold = adSets.reduce((n, a) => n + a.lifetimeSales, 0);
  const summary = `${money(spent)} spent so far for ${sales(sold)}${sold ? ` (${money(Math.round(spent / sold))} each)` : ""}.`;
  const rules = `Rules: pause at ${money(PAUSE_SPEND_WITHOUT_SALES_CENTS)} with no sales, keep under ${money(
    d.targetCostPerSaleCents,
  )} a sale, new ad when people have seen it more than ${TIRED_FREQUENCY} times.`;
  const missed = "Meta counts pixel and server purchases. A sale it missed is in Stripe and on the dashboard.";
  const subject = `Tommy Top Decker Meta ads, ${title}: ${actions.length ? `${actions.length} to do` : "nothing to do"}`;

  const th = "padding:6px 4px;border-bottom:2px solid #111111";
  const td = "padding:9px 4px;border-bottom:1px solid #eeeeee";
  const off = (s: { status: string }) => (isOn(s) ? "" : ` <span style="color:#6b7280;font-size:11px">(off)</span>`);
  const label = (s: string) => `<div style="font-size:10px;letter-spacing:.14em;color:#6b7280;font-weight:700;margin-bottom:8px">${s}</div>`;

  const adSetRow = (a: CheckAdSet) => {
    const v = adSetVerdict(a, d.targetCostPerSaleCents);
    return (
      `<tr>` +
      `<td style="${td}">${esc(a.name)}${off(a)}</td>` +
      `<td align="right" style="${td}">${optMoney(a.dailyBudgetCents)}</td>` +
      `<td align="right" style="${td}">${money(a.spend7dCents)}</td>` +
      `<td align="right" style="${td};font-weight:700">${a.lifetimeSales}</td>` +
      `<td align="right" style="${td}">${optMoney(costPerSale(a))}</td>` +
      `<td align="right" style="${td}">${pct(a.ctr7d)}</td>` +
      `<td align="right" style="${td}"><span style="${CHIP_STYLE[v.tone]};font-size:11px;padding:3px 8px;border-radius:10px;white-space:nowrap">${esc(v.label)}</span></td>` +
      `</tr>`
    );
  };
  const adRow = (a: CheckAd) =>
    `<tr>` +
    `<td style="${td}">${esc(a.name)}${off(a)}</td>` +
    `<td style="${td};color:#6b7280">${esc(a.adSetName)}</td>` +
    `<td align="right" style="${td}">${money(a.spend7dCents)}</td>` +
    `<td align="right" style="${td}">${pct(a.ctr7d)}</td>` +
    `<td align="right" style="${td};font-weight:700">${a.sales7d}</td>` +
    `</tr>`;

  const actionsHtml = actions.length
    ? `<ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.6">${actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>`
    : `<div style="font-size:14px;color:#15803d;font-weight:700">Nothing to do. Every ad set is running inside the rules.</div>`;

  const html = [
    `<div style="margin:0;background:#f4f0e8">`,
    `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f0e8" style="background:#f4f0e8"><tr><td align="center" style="padding:20px 0">`,
    `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:#111111">`,
    `<tr><td bgcolor="#000000" style="background:#000000;padding:22px 24px"><table width="100%" cellpadding="0" cellspacing="0"><tr>`,
    `<td><span style="display:block;font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.16em;color:#f4f0e8">META ADS</span>`,
    `<span style="display:block;font-family:'Arial Black',Impact,Helvetica,sans-serif;font-weight:900;font-size:22px;text-transform:uppercase;color:#ffffff;margin-top:6px">${esc(title)}</span></td>`,
    `<td align="right" valign="bottom" style="font-size:12px;color:#9ca3af">${esc(shortDay(d.day))}<br>Internal</td>`,
    `</tr></table></td></tr>`,
    `<tr><td style="padding:16px 24px 0;font-size:14px"><strong>${esc(question)}</strong><br><span style="color:#374151">${esc(summary)}</span></td></tr>`,
    `<tr><td style="padding:18px 24px 0">${label("TO DO")}${actionsHtml}</td></tr>`,
    `<tr><td style="padding:22px 24px 0"><table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">`,
    `<tr style="font-size:10px;letter-spacing:.1em;color:#6b7280">`,
    `<td style="${th}">AD SET</td><td align="right" style="${th}">PER DAY</td><td align="right" style="${th}">SPENT 7D</td>`,
    `<td align="right" style="${th}">SALES</td><td align="right" style="${th}">PER SALE</td><td align="right" style="${th}">CLICK RATE</td>`,
    `<td align="right" style="${th}">CALL</td></tr>`,
    ...adSets.map(adSetRow),
    `</table></td></tr>`,
    ...(ads.length
      ? [
          `<tr><td style="padding:22px 24px 0"><table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">`,
          `<tr style="font-size:10px;letter-spacing:.1em;color:#6b7280">`,
          `<td style="${th}">AD</td><td style="${th}">AD SET</td><td align="right" style="${th}">SPENT 7D</td>`,
          `<td align="right" style="${th}">CLICK RATE</td><td align="right" style="${th}">SALES 7D</td></tr>`,
          ...ads.map(adRow),
          `</table></td></tr>`,
        ]
      : []),
    `<tr><td style="padding:14px 24px 0;font-size:12px;color:#6b7280;line-height:1.5">Ad set sales and cost per sale are since launch. ${esc(rules)}<br>${esc(missed)}</td></tr>`,
    `<tr><td align="center" style="padding:24px 0 12px"><a href="${esc(ADS_MANAGER_URL)}" style="display:inline-block;background:#000000;color:#ffffff;font:700 11px Helvetica,Arial,sans-serif;letter-spacing:.25em;padding:12px 30px;border-radius:4px;text-decoration:none">OPEN ADS MANAGER</a></td></tr>`,
    `<tr><td align="center" style="padding:0 24px 26px;font-size:11px;color:#9ca3af">Sent at 9 AM PT on Oct 21, Oct 23, Oct 28 and every Monday while the campaign runs. Nothing here changes a budget.</td></tr>`,
    `</table></td></tr></table></div>`,
  ].join("");

  const text = [
    `Tommy Top Decker Meta ads, ${title} (${shortDay(d.day)})`,
    question,
    summary,
    ``,
    `To do:`,
    ...(actions.length ? actions.map((a, i) => `${i + 1}. ${a}`) : ["Nothing to do. Every ad set is running inside the rules."]),
    ``,
    `Ad sets (sales since launch):`,
    ...adSets.map(
      (a) =>
        `- ${a.name}${isOn(a) ? "" : " (off)"}: ${optMoney(a.dailyBudgetCents)}/day, ${money(a.spend7dCents)} spent in 7 days, ${sales(
          a.lifetimeSales,
        )}, ${optMoney(costPerSale(a))} per sale, ${adSetVerdict(a, d.targetCostPerSaleCents).label}`,
    ),
    ...(ads.length
      ? [``, `Ads (last 7 days):`, ...ads.map((a) => `- ${a.name}${isOn(a) ? "" : " (off)"}: ${money(a.spend7dCents)}, ${pct(a.ctr7d)} click rate, ${sales(a.sales7d)}`)]
      : []),
    ``,
    rules,
    missed,
    ``,
    `Ads Manager: ${ADS_MANAGER_URL}`,
  ].join("\n");

  return { subject, html, text };
}
