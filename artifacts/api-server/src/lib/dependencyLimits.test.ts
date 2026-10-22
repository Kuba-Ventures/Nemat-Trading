import { test } from "node:test";
import assert from "node:assert/strict";
import { daysLeftAtRecentPace, describeDaysLeft, withRunningLowForecast } from "./dependencyLimits";
import type { DependencyCheckResult } from "./dependencyChecks";

const now = Date.parse("2026-10-22T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

const removeBgCheck = (remaining: number): DependencyCheckResult => ({
  service: "removebg",
  status: "working",
  failureKind: null,
  failureDetail: null,
  latencyMilliseconds: 300,
  limitRemaining: remaining,
  limitUnit: "credits",
  note: null,
});

test("days left uses this week's pace", () => {
  assert.equal(daysLeftAtRecentPace(12, [{ checkedAt: daysAgo(3), remaining: 21 }], now), 4);
});

test("a top up is not counted as negative use", () => {
  const days = daysLeftAtRecentPace(
    100,
    [
      { checkedAt: daysAgo(1), remaining: 104 },
      { checkedAt: daysAgo(2), remaining: 2 },
      { checkedAt: daysAgo(4), remaining: 10 },
    ],
    now,
  );
  assert.equal(days, 100 / ((8 + 4) / 4));
});

test("no use, or too little history, gives no forecast", () => {
  assert.equal(daysLeftAtRecentPace(50, [{ checkedAt: daysAgo(2), remaining: 50 }], now), null);
  assert.equal(daysLeftAtRecentPace(40, [{ checkedAt: daysAgo(0.1), remaining: 50 }], now), null);
  assert.equal(daysLeftAtRecentPace(40, [], now), null);
});

test("days left reads naturally", () => {
  assert.equal(describeDaysLeft(4.2), "about 4 days left");
  assert.equal(describeDaysLeft(35), "about 5 weeks left");
  assert.equal(describeDaysLeft(0.4), "less than a day left");
  assert.equal(describeDaysLeft(null), "no recent use");
});

test("a balance that lasts about a week or less becomes running low", () => {
  const low = withRunningLowForecast(removeBgCheck(12), [{ checkedAt: daysAgo(3), remaining: 21 }], now);
  assert.equal(low.status, "warning");
  assert.equal(low.failureKind, "running_low");
  assert.equal(low.note, "12 credits, about 4 days left");
  const fine = withRunningLowForecast(removeBgCheck(412), [{ checkedAt: daysAgo(7), remaining: 496 }], now);
  assert.equal(fine.status, "working");
  assert.equal(fine.note, "412 credits, about 5 weeks left");
});
