import { test } from "node:test";
import assert from "node:assert/strict";
import { parcelFor, pickRate, type ShippoRate } from "./shippo";

const rate = (id: string, name: string, token: string, amount: string, provider = "USPS"): ShippoRate => ({
  object_id: id,
  amount,
  currency: "USD",
  provider,
  servicelevel: { name, token },
});

const RATES = [
  rate("r_ga", "Ground Advantage", "usps_ground_advantage", "5.20"),
  rate("r_pri", "Priority Mail", "usps_priority", "9.10"),
  rate("r_ups", "Ground", "ups_ground", "4.00", "UPS"),
];

test("parcelFor: 2 oz for one pack, plus 0.7 oz per extra pack", () => {
  assert.equal(parcelFor(1).weight, "2.00");
  assert.equal(parcelFor(2).weight, "2.70");
  assert.equal(parcelFor(0).weight, "2.00");
  assert.equal(parcelFor(1).length, "6");
});

test("pickRate prefers the service token from checkout", () => {
  const p = pickRate(RATES, { servicelevelToken: "usps_priority", displayName: "USPS Ground Advantage" });
  assert.equal(p?.rate.object_id, "r_pri");
  assert.equal(p?.fallback, false);
});

test("pickRate falls back to the display name for older sessions", () => {
  const p = pickRate(RATES, { displayName: "USPS Priority Mail" });
  assert.equal(p?.rate.object_id, "r_pri");
  assert.equal(p?.fallback, false);
});

test("pickRate uses the cheapest USPS rate, flagged, when nothing matches", () => {
  const p = pickRate(RATES, { servicelevelToken: "usps_gone", displayName: "USPS Gone" });
  assert.equal(p?.rate.object_id, "r_ga");
  assert.equal(p?.fallback, true);
});

test("pickRate never picks a non-USPS rate and returns null without USPS", () => {
  assert.equal(pickRate([RATES[2]], {}), null);
});
