import { test } from "node:test";
import assert from "node:assert/strict";
import {
  campaignEnd,
  campaignStatus,
  classifySource,
  dayKey,
  daysBetween,
  feesByCharge,
  isInternalEmail,
  parseMetaInsights,
  parseRange,
  purchasesFrom,
  ratio,
  summarizeOrders,
  type OrderExtras,
  type PaidOrder,
} from "./metrics";

const NOW = new Date("2026-10-14T19:00:00Z"); // Oct 14, noon in Palo Alto

test("parseRange: known keys, case-insensitive, 30d fallback, all has no start", () => {
  assert.equal(parseRange("7D", NOW).key, "7d");
  assert.equal(parseRange("bogus", NOW).key, "30d");
  assert.equal(parseRange(undefined, NOW).key, "30d");
  assert.equal(parseRange("all", NOW).start, null);
  const r = parseRange("7d", NOW);
  assert.equal(dayKey(r.start!), "2026-10-08");
  assert.equal(r.start!.toISOString(), "2026-10-08T07:00:00.000Z"); // midnight PDT
});

test("daysBetween lists every business day inclusive, across DST", () => {
  assert.deepEqual(daysBetween(parseRange("7d", NOW).start!, NOW), [
    "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14",
  ]);
  const dst = daysBetween(new Date("2026-10-31T19:00:00Z"), new Date("2026-11-03T19:00:00Z"));
  assert.deepEqual(dst, ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
});

test("isInternalEmail matches the team domain only", () => {
  assert.equal(isInternalEmail("Finley@QSBSRollover.com"), true);
  assert.equal(isInternalEmail("buyer@gmail.com"), false);
  assert.equal(isInternalEmail(""), false);
  assert.equal(isInternalEmail(null), false);
});

test("ratio guards zero and missing denominators", () => {
  assert.equal(ratio(500, 250), 2);
  assert.equal(ratio(500, 0), null);
  assert.equal(ratio(500, null), null);
});

test("classifySource: Meta click ids or tags, the insert QR, else direct", () => {
  assert.equal(classifySource({ fbclid: "abc" }), "Meta");
  assert.equal(classifySource({ utmSource: "Instagram" }), "Meta");
  assert.equal(classifySource({ utmSource: "insert" }), "Thank-you card");
  assert.equal(classifySource({ utmSource: "google" }), "Google");
  assert.equal(classifySource({ utmSource: "newsletter" }), "Other");
  assert.equal(classifySource({}), "Direct");
});

const order = (id: string, over: Partial<PaidOrder> = {}): PaidOrder => ({
  sessionId: `cs_live_${id}`,
  created: new Date("2026-10-10T20:00:00Z"),
  email: "buyer@example.com",
  totalCents: 4000,
  discountCents: 0,
  refundedCents: 0,
  feeCents: 146,
  chargeId: `ch_${id}`,
  ...over,
});

test("summarizeOrders drops internal and fully refunded orders and totals the rest", () => {
  const orders = [
    order("aaaaaaaa"),
    order("bbbbbbbb", { discountCents: 400, totalCents: 3600, created: new Date("2026-10-12T20:00:00Z") }),
    order("cccccccc", { refundedCents: 1000 }), // partial refund counts
    order("dddddddd", { refundedCents: 4000 }), // fully refunded: dropped
    order("eeeeeeee", { email: "finley@qsbsrollover.com" }), // internal: dropped
  ];
  const extras = new Map<string, OrderExtras>([
    ["cs_live_aaaaaaaa", { labelCostCents: 527, labelBought: true, source: "Meta" }],
    ["cs_live_bbbbbbbb", { labelCostCents: null, labelBought: false, source: "Thank-you card" }],
  ]);
  const days = daysBetween(parseRange("7d", NOW).start!, NOW);
  const s = summarizeOrders(orders, extras, days);

  assert.equal(s.orders, 3);
  assert.equal(s.grossCents, 4000 + 4000 + 4000);
  assert.equal(s.discountCents, 400);
  assert.equal(s.refundCents, 1000);
  assert.equal(s.netCents, 12000 - 400 - 1000);
  assert.equal(s.avgOrderCents, Math.round(10600 / 3));
  assert.equal(s.feeCents, 146 * 3);
  assert.equal(s.postageCents, 527);
  assert.equal(s.repeatBuyers, 1);
  assert.equal(s.daily.find((d) => d.date === "2026-10-10")!.revenueCents, 4000 + 3000);
  assert.equal(s.daily.find((d) => d.date === "2026-10-12")!.revenueCents, 3600);
  assert.equal(s.recent[0].ref, "BBBBBBBB");
  assert.equal(s.recent.find((r) => r.ref === "AAAAAAAA")!.labelBought, true);
  assert.deepEqual(s.sources.map((x) => x.source), ["Meta", "Thank-you card", "Direct"]);
});

test("summarizeOrders with nothing in range has no average", () => {
  const s = summarizeOrders([], new Map(), ["2026-10-14"]);
  assert.equal(s.orders, 0);
  assert.equal(s.avgOrderCents, null);
  assert.deepEqual(s.daily, [{ date: "2026-10-14", revenueCents: 0 }]);
});

test("purchasesFrom never double counts overlapping Meta purchase types", () => {
  assert.equal(
    purchasesFrom([
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
      { action_type: "purchase", value: "2" },
      { action_type: "omni_purchase", value: "2" },
    ]),
    2,
  );
  assert.equal(purchasesFrom([{ action_type: "link_click", value: "40" }]), 0);
  assert.equal(purchasesFrom(undefined), 0);
});

test("parseMetaInsights merges insights, status and daily spend", () => {
  const days = ["2026-09-28", "2026-09-29", "2026-09-30"];
  const m = parseMetaInsights(
    {
      data: [
        { campaign_id: "1", campaign_name: "TTD Nemat - TMNT Collector - Sales", spend: "133.88", ctr: "4.86", actions: [{ action_type: "purchase", value: "1" }] },
      ],
    },
    { data: [{ date_start: "2026-09-28", spend: "20.10" }, { date_start: "2026-09-29", spend: "19.5" }, { date_start: "2026-08-01", spend: "9" }] },
    {
      data: [
        { id: "1", name: "TTD Nemat - TMNT Collector - Sales", effective_status: "COMPLETED" },
        { id: "2", name: "TTD Cold - Stage 3", effective_status: "PAUSED" }, // no spend, not active: hidden
        { id: "3", name: "TTD Relaunch", effective_status: "ACTIVE" },
      ],
    },
    days,
  );
  assert.equal(m.spendCents, 13388);
  assert.deepEqual(m.campaigns.map((c) => c.id), ["3", "1"]);
  assert.equal(m.campaigns[1].ctr, 4.86);
  assert.equal(m.campaigns[1].purchases, 1);
  assert.equal(m.campaigns[0].ctr, null);
  assert.deepEqual(m.daily, [
    { date: "2026-09-28", spendCents: 2010 },
    { date: "2026-09-29", spendCents: 1950 },
    { date: "2026-09-30", spendCents: 0 },
  ]);
});

test("campaignStatus: a passed end date wins over ACTIVE, paused and completed map cleanly", () => {
  assert.deepEqual(campaignStatus("ACTIVE", "2026-10-06T23:59:00-0700", NOW), { state: "ended", label: "Ended Oct 6" });
  assert.deepEqual(campaignStatus("ACTIVE", "2026-10-20T00:00:00-0700", NOW), { state: "active", label: "Active" });
  assert.deepEqual(campaignStatus("ACTIVE", null, NOW), { state: "active", label: "Active" });
  assert.deepEqual(campaignStatus("CAMPAIGN_PAUSED", "2026-10-06T23:59:00-0700", NOW), { state: "paused", label: "Paused" });
  assert.deepEqual(campaignStatus("PAUSED", null, NOW), { state: "paused", label: "Paused" });
  assert.deepEqual(campaignStatus("COMPLETED", null, NOW), { state: "ended", label: "Ended" });
  assert.deepEqual(campaignStatus("ARCHIVED", null, NOW), { state: "other", label: "Archived" });
});

test("campaignEnd: stop_time, else the latest ad set end only when every ad set has one", () => {
  assert.equal(campaignEnd({ stop_time: "2026-10-06T23:59:00-0700" }), "2026-10-06T23:59:00-0700");
  assert.equal(
    campaignEnd({ adsets: { data: [{ end_time: "2026-10-01T00:00:00-0700" }, { end_time: "2026-10-06T23:59:00-0700" }] } }),
    "2026-10-06T23:59:00-0700",
  );
  assert.equal(campaignEnd({ adsets: { data: [{ end_time: "2026-10-06T23:59:00-0700" }, {}] } }), null);
  assert.equal(campaignEnd({}), null);
});

test("parseMetaInsights shows an ACTIVE campaign past its end date as ended, after running ones", () => {
  const m = parseMetaInsights(
    { data: [{ campaign_id: "1", campaign_name: "TMNT", spend: "133.88" }] },
    { data: [] },
    {
      data: [
        { id: "1", name: "TMNT", effective_status: "ACTIVE", adsets: { data: [{ end_time: "2026-10-06T23:59:00-0700" }] } },
        { id: "2", name: "Relaunch", effective_status: "ACTIVE" },
      ],
    },
    [],
    NOW,
  );
  assert.deepEqual(m.campaigns.map((c) => [c.id, c.state, c.statusLabel]), [
    ["2", "active", "Active"],
    ["1", "ended", "Ended Oct 6"],
  ]);
});

test("feesByCharge counts card and Cash App Pay fees, ignores refunds and payouts", () => {
  const fees = feesByCharge([
    { type: "charge", fee: 147, source: "ch_card" },
    { type: "payment", fee: 155, source: "py_cashapp" },
    { type: "refund", fee: 0, source: "re_x" },
    { type: "payout", fee: 0, source: { id: "po_x" } },
    { type: "charge", fee: 99, source: { id: "ch_expanded" } },
    { type: "charge", fee: 50, source: null },
  ]);
  assert.deepEqual([...fees], [
    ["ch_card", 147],
    ["py_cashapp", 155],
    ["ch_expanded", 99],
  ]);
});
