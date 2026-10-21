import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adSetVerdict,
  buildCheckEmail,
  checkActions,
  checkKindForDay,
  checkRecipients,
  dueCheck,
  isCampaignRunning,
  reportedAdSets,
  reportedAds,
  type CheckAd,
  type CheckAdSet,
  type CheckData,
} from "./metaAdsCheck";

const TARGET = 4000;

const adSet = (over: Partial<CheckAdSet> = {}): CheckAdSet => ({
  name: "Prospecting - US 18+ Broad - Purchase - $20",
  status: "ACTIVE",
  dailyBudgetCents: 2000,
  lifetimeSpendCents: 3000,
  lifetimeSales: 0,
  spend7dCents: 3000,
  impressions7d: 1200,
  ctr7d: 3.1,
  frequency7d: 1.4,
  ...over,
});

const ad = (over: Partial<CheckAd> = {}): CheckAd => ({
  name: "Reel - Counter",
  adSetName: "Prospecting - US 18+ Broad - Purchase - $20",
  status: "ACTIVE",
  reviewFeedback: null,
  spend7dCents: 1200,
  ctr7d: 2.5,
  sales7d: 0,
  ...over,
});

const data = (over: Partial<CheckData> = {}): CheckData => ({
  kind: "weekly",
  day: "2026-10-26",
  adSets: [adSet()],
  ads: [ad()],
  targetCostPerSaleCents: TARGET,
  ...over,
});

test("checkKindForDay: the Reel test's one-off days, then Mondays", () => {
  assert.equal(checkKindForDay("2026-10-21", "Wed"), "day_one");
  assert.equal(checkKindForDay("2026-10-23", "Fri"), "day_three");
  assert.equal(checkKindForDay("2026-10-28", "Wed"), "review");
  assert.equal(checkKindForDay("2026-10-26", "Mon"), "weekly");
  assert.equal(checkKindForDay("2026-11-02", "Mon"), "weekly");
  assert.equal(checkKindForDay("2026-10-19", "Mon"), null); // before the first weekly
  assert.equal(checkKindForDay("2026-10-22", "Thu"), null);
});

test("dueCheck: only after 9 AM PT on a check day", () => {
  assert.equal(dueCheck(new Date("2026-10-23T15:59:00Z")), null); // 8:59 AM PDT
  assert.equal(dueCheck(new Date("2026-10-23T16:00:00Z")), "day_three");
  assert.equal(dueCheck(new Date("2026-10-24T06:30:00Z")), "day_three"); // 11:30 PM PDT, same day
  assert.equal(dueCheck(new Date("2026-10-22T18:00:00Z")), null);
  assert.equal(dueCheck(new Date("2026-11-02T17:05:00Z")), "weekly"); // 9:05 AM PST after DST ends
});

test("checkRecipients: team addresses only", () => {
  assert.deepEqual(checkRecipients("finley@qsbsrollover.com, shawnn@gmail.com, nope"), ["finley@qsbsrollover.com"]);
  assert.deepEqual(checkRecipients(""), []);
});

test("adSetVerdict: pause, not spending, tired, over target, keep, too early", () => {
  assert.equal(adSetVerdict(adSet({ lifetimeSpendCents: 9182 }), TARGET).label, "Pause");
  assert.equal(adSetVerdict(adSet({ impressions7d: 0 }), TARGET).label, "Not spending");
  assert.equal(adSetVerdict(adSet({ frequency7d: 3.4 }), TARGET).label, "Needs a new ad");
  assert.equal(adSetVerdict(adSet({ lifetimeSpendCents: 9000, lifetimeSales: 1 }), TARGET).label, "Over $40 a sale");
  assert.equal(adSetVerdict(adSet({ lifetimeSpendCents: 3500, lifetimeSales: 1 }), TARGET).label, "Keep");
  assert.equal(adSetVerdict(adSet(), TARGET).label, "Too early");
});

test("adSetVerdict: a new Reel holds off the pause, a set that stopped spending isn't paused", () => {
  const spent = adSet({ lifetimeSpendCents: 12757, spend7dCents: 11877 });
  assert.equal(adSetVerdict(spent, TARGET, [ad({ spend7dCents: 1612 })]).label, "Reel test");
  assert.equal(adSetVerdict(spent, TARGET, [ad({ spend7dCents: 8100 })]).label, "Pause");
  assert.equal(adSetVerdict(spent, TARGET, [ad({ status: "PAUSED" })]).label, "Pause");
  assert.equal(adSetVerdict(spent, TARGET, [ad({ adSetName: "Retargeting - Visitors 30d - Purchase - $5" })]).label, "Pause");
  const done = adSet({ name: "US 18+ Broad - Purchase", lifetimeSpendCents: 13388, spend7dCents: 0, impressions7d: 0 });
  assert.notEqual(adSetVerdict(done, TARGET).label, "Pause");
});

test("reportedAdSets and reportedAds: finished campaigns drop out, flagged ads stay", () => {
  const done = adSet({ name: "US 18+ Broad - Purchase", status: "CAMPAIGN_PAUSED", spend7dCents: 0, lifetimeSpendCents: 13388 });
  assert.deepEqual(reportedAdSets([adSet(), done]).map((a) => a.name), [adSet().name]);
  const rejected = ad({ name: "Reel - Explosion", status: "DISAPPROVED", spend7dCents: 0 });
  const offAd = ad({ name: "A3 - Scarcity - Alley", status: "PAUSED", spend7dCents: 0 });
  assert.deepEqual(reportedAds([ad(), rejected, offAd]).map((a) => a.name), ["Reel - Counter", "Reel - Explosion"]);
  assert.equal(isCampaignRunning([done]), false);
  assert.equal(isCampaignRunning([adSet()]), true);
});

test("checkActions: rejected ads, Reels not spending on day 1, ad set calls", () => {
  const d = data({
    kind: "day_one",
    adSets: [
      adSet({ lifetimeSpendCents: 9182 }),
      adSet({ name: "Retargeting - Visitors 30d - Purchase - $5", lifetimeSpendCents: 9182 }),
    ],
    ads: [ad({ spend7dCents: 0 }), ad({ name: "Reel - Explosion", status: "DISAPPROVED", reviewFeedback: "Personal attributes" })],
  });
  assert.deepEqual(checkActions(d), [
    'Ad "Reel - Explosion" in Prospecting - US 18+ Broad - Purchase - $20 is rejected: Personal attributes. Fix it or replace it.',
    "Reel - Counter hasn't spent yet. Check it cleared review.",
    "Pause Retargeting - Visitors 30d - Purchase - $5: $91.82 spent with no sales.",
  ]);
  assert.deepEqual(checkActions(data()), []);
  assert.equal(checkActions(data({ kind: "review" })).length, 1);
});

test("buildCheckEmail: subject, sales wording, both tables, no em dashes", () => {
  const nothing = buildCheckEmail(data());
  assert.equal(nothing.subject, "Tommy Top Decker Meta ads, Weekly check: nothing to do");
  assert.match(nothing.text, /\$30\.00 spent so far for 0 sales\./);
  assert.match(nothing.html, /SALES 7D/);
  assert.match(nothing.html, /Nothing to do/);

  const todo = buildCheckEmail(data({ kind: "day_three", adSets: [adSet({ lifetimeSpendCents: 8000, lifetimeSales: 2 })] }));
  assert.equal(todo.subject, "Tommy Top Decker Meta ads, Reels day 3 check: nothing to do");
  assert.match(todo.text, /\$80\.00 spent so far for 2 sales \(\$40\.00 each\)/);

  for (const e of [nothing, todo]) {
    assert.equal(/\u2014/.test(e.html + e.text + e.subject), false);
  }
});

test("buildCheckEmail: escapes names", () => {
  const e = buildCheckEmail(data({ ads: [ad({ name: "Reel <b>" })] }));
  assert.match(e.html, /Reel &lt;b&gt;/);
});
