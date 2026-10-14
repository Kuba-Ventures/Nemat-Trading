import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestAd,
  buildSnapshotEmail,
  changeLabel,
  changeTone,
  checkoutChip,
  checkoutRate,
  costChip,
  costPerSale,
  ctrChip,
  keptCents,
  lastSendSlot,
  rangeLabel,
  snapshotWindows,
  trendChip,
  type SnapshotData,
  type WeekNumbers,
} from "./weeklySnapshot";

const week = (over: Partial<WeekNumbers> = {}): WeekNumbers => ({
  revenueCents: 4307,
  orders: 1,
  feeCents: 155,
  postageCents: 0,
  refundCents: 0,
  discountCents: 0,
  spendCents: 13388,
  ctr: 4.9,
  checkoutSessions: 30,
  ...over,
});

test("lastSendSlot: Friday before 4 PM PT is still last week's slot", () => {
  // Fri Oct 23 2026, 3:59 PM PDT = 22:59 UTC
  const slot = lastSendSlot(new Date("2026-10-23T22:59:00Z"));
  assert.equal(slot.toISOString(), "2026-10-16T23:00:00.000Z");
});

test("lastSendSlot: at and after Friday 4 PM PT it's this week's slot", () => {
  assert.equal(lastSendSlot(new Date("2026-10-23T23:00:00Z")).toISOString(), "2026-10-23T23:00:00.000Z");
  // Tue Oct 27 still points at Fri Oct 23
  assert.equal(lastSendSlot(new Date("2026-10-27T18:00:00Z")).toISOString(), "2026-10-23T23:00:00.000Z");
});

test("lastSendSlot: after DST ends, 4 PM PST is 00:00 UTC Saturday", () => {
  // DST ends Sun Nov 1 2026. Fri Nov 6, 4 PM PST = Sat Nov 7 00:00 UTC
  assert.equal(lastSendSlot(new Date("2026-11-07T01:00:00Z")).toISOString(), "2026-11-07T00:00:00.000Z");
});

test("snapshotWindows: Friday to Thursday before the send, and the week before that", () => {
  const { week: w, prior, key } = snapshotWindows(new Date("2026-10-23T23:00:00Z"));
  assert.equal(key, "2026-10-23");
  assert.deepEqual(w.days, ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.equal(w.start.toISOString(), "2026-10-16T07:00:00.000Z"); // midnight PDT
  assert.equal(w.end.toISOString(), "2026-10-23T06:59:59.999Z");
  assert.equal(prior.days[0], "2026-10-09");
  assert.equal(prior.days[6], "2026-10-15");
  assert.equal(rangeLabel(w), "Oct 16 to Oct 22");
});

test("snapshotWindows: a week spanning the DST change still has 7 days", () => {
  const { week: w } = snapshotWindows(new Date("2026-11-07T00:00:00Z"));
  assert.equal(w.days.length, 7);
  assert.equal(w.days[0], "2026-10-30");
  assert.equal(w.days[6], "2026-11-05");
  assert.equal(w.end.toISOString(), "2026-11-06T07:59:59.999Z"); // midnight PST
});

test("costPerSale, checkoutRate and keptCents", () => {
  assert.equal(costPerSale(week()), 13388);
  assert.equal(costPerSale(week({ orders: 0 })), null);
  assert.equal(costPerSale(week({ spendCents: null })), null);
  assert.equal(checkoutRate(week()), (1 / 30) * 100);
  assert.equal(checkoutRate(week({ checkoutSessions: 0 })), null);
  assert.equal(checkoutRate(week({ orders: 5, checkoutSessions: 3 })), 100); // capped
  assert.equal(keptCents(week()), 4307 - 155 - 13388);
  assert.equal(keptCents(week({ spendCents: null })), 4307 - 155);
});

test("costChip against the $40 target", () => {
  assert.deepEqual(costChip(week(), 4000), { label: "Off target", tone: "bad" });
  assert.deepEqual(costChip(week({ spendCents: 3500 }), 4000), { label: "On target", tone: "good" });
  assert.deepEqual(costChip(week({ orders: 0 }), 4000), { label: "No sales", tone: "bad" });
  assert.deepEqual(costChip(week({ spendCents: 0, orders: 0 }), 4000), { label: "No spend", tone: "neutral" });
  assert.deepEqual(costChip(week({ spendCents: null }), 4000), { label: "No ad data", tone: "neutral" });
});

test("click rate, checkout and trend chips", () => {
  assert.equal(ctrChip(4.9).label, "Strong");
  assert.equal(ctrChip(1.5).label, "Average");
  assert.equal(ctrChip(0.6).label, "Weak");
  assert.equal(checkoutChip(3.3).label, "Weak");
  assert.equal(checkoutChip(45).label, "Strong");
  assert.equal(checkoutChip(null).label, "No data");
  assert.deepEqual(trendChip(5, 3), { label: "Up", tone: "good" });
  assert.deepEqual(trendChip(5, 3, false), { label: "Up", tone: "bad" });
  assert.deepEqual(trendChip(3, 3), { label: "Flat", tone: "neutral" });
});

test("changeLabel", () => {
  assert.equal(changeLabel(4307, 0, "money"), "▲ $43.07");
  assert.equal(changeLabel(-9236, 0, "money"), "▼ $92.36");
  assert.equal(changeLabel(2, 2, "count"), "no change");
  assert.equal(changeLabel(4.9, 3.7, "pct"), "▲ 1.2 pts");
  assert.equal(changeLabel(4.9, null, "pct"), "new");
  assert.equal(changeLabel(null, 3, "pct"), "-");
});

test("bestAd: most sales, then click rate, ignoring ads under $5", () => {
  const ads = [
    { name: "Price Drop counter", spendCents: 9000, ctr: 5.2, purchases: 1 },
    { name: "Epic Sealed Drops NYC", spendCents: 2000, ctr: 6.0, purchases: 1 },
    { name: "Tiny", spendCents: 300, ctr: 20, purchases: 3 },
  ];
  assert.equal(bestAd(ads)?.name, "Epic Sealed Drops NYC");
  assert.equal(bestAd([]), null);
});

const sample = (): SnapshotData => {
  const { week: w, prior } = snapshotWindows(new Date("2026-10-23T23:00:00Z"));
  return {
    week: w,
    prior,
    thisWeek: week(),
    lastWeek: week({ revenueCents: 0, orders: 0, feeCents: 0, spendCents: 0, ctr: null, checkoutSessions: 12 }),
    dailyRevenueCents: [0, 0, 4307, 0, 0, 0, 0],
    dailySpendCents: [750, 560, 2240, 800, 1500, 3800, 3738],
    adSets: [
      { name: "Prospecting", spendCents: 10710, purchases: 1 },
      { name: "Retargeting", spendCents: 2678, purchases: 0 },
    ],
    ads: [{ name: "Price Drop counter", spendCents: 7000, ctr: 5.2, purchases: 1 }],
    targetCostPerSaleCents: 4000,
    dashboardUrl: "https://tommytopdecker.com/admin",
    problems: [],
  };
};

test("buildSnapshotEmail: subject, scorecard values and campaign block", () => {
  const e = buildSnapshotEmail(sample());
  assert.equal(e.subject, "Tommy Top Decker weekly scorecard: Oct 16 to Oct 22");
  for (const s of ["$43.07", "$133.88", "Off target", "4.9%", "-$92.36", "Prospecting: $107.10, 1 sale", "Best ad: Price Drop counter", "vs. Oct 9 to Oct 15", "https://tommytopdecker.com/admin"]) {
    assert.ok(e.html.includes(s), `html missing ${s}`);
  }
  assert.ok(e.text.includes("Cost per sale (target $40): $133.88"));
  assert.ok(!e.html.includes("\u2014") && !e.text.includes("\u2014"), "no em dashes");
});

test("buildSnapshotEmail: shows failed sources and escapes names", () => {
  const d = sample();
  d.problems = ["Meta ad data unavailable"];
  d.adSets = [{ name: "<b>x</b>", spendCents: 100, purchases: 0 }];
  const e = buildSnapshotEmail(d);
  assert.ok(e.html.includes("Meta ad data unavailable."));
  assert.ok(e.html.includes("&lt;b&gt;x&lt;/b&gt;"));
});

test("changeTone: colors by whether the move is good news", () => {
  assert.equal(changeTone({ change: "▲ 3.3 pts", better: "up" }), "good");
  assert.equal(changeTone({ change: "▲ $12.00", better: "down" }), "bad"); // cost per sale went up
  assert.equal(changeTone({ change: "▼ $12.00", better: "down" }), "good");
  assert.equal(changeTone({ change: "▲ $12.00", better: "none" }), "neutral");
  assert.equal(changeTone({ change: "new", better: "up" }), "neutral");
});
