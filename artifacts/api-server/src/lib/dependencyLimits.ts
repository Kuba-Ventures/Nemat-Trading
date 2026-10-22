// "Running low": for a service that reports a balance (today remove.bg credits),
// how long the balance lasts at the pace of the last 7 days, and whether that is
// close enough to running out to warn. Pure, so it is unit tested.

import type { DependencyCheckResult } from "./dependencyChecks";

export type LimitReading = { checkedAt: string; remaining: number };

export const RUNNING_LOW_WITHIN_DAYS = 7;
const PACE_WINDOW_DAYS = 7;
const MINIMUM_PACE_SPAN_HOURS = 6;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

// Top ups make the balance jump up, so the pace only counts the drops between
// consecutive readings. Null means no measurable use yet.
export function daysLeftAtRecentPace(
  currentRemaining: number,
  earlierReadingsNewestFirst: LimitReading[],
  nowMilliseconds: number,
): number | null {
  const windowStart = nowMilliseconds - PACE_WINDOW_DAYS * DAY_MILLISECONDS;
  const readingsOldestFirst = earlierReadingsNewestFirst
    .filter((reading) => Date.parse(reading.checkedAt) >= windowStart)
    .reverse();
  if (readingsOldestFirst.length === 0) return null;
  const spanMilliseconds = nowMilliseconds - Date.parse(readingsOldestFirst[0].checkedAt);
  if (spanMilliseconds < MINIMUM_PACE_SPAN_HOURS * 60 * 60 * 1000) return null;

  const sequence = [...readingsOldestFirst.map((reading) => reading.remaining), currentRemaining];
  let usedInWindow = 0;
  for (let index = 1; index < sequence.length; index++) {
    usedInWindow += Math.max(0, sequence[index - 1] - sequence[index]);
  }
  if (usedInWindow <= 0) return null;
  const usedPerDay = usedInWindow / (spanMilliseconds / DAY_MILLISECONDS);
  return currentRemaining / usedPerDay;
}

export function describeDaysLeft(daysLeft: number | null): string {
  if (daysLeft === null) return "no recent use";
  if (daysLeft < 1) return "less than a day left";
  if (daysLeft < 14) {
    const days = Math.round(daysLeft);
    return `about ${days} day${days === 1 ? "" : "s"} left`;
  }
  if (daysLeft < 70) return `about ${Math.round(daysLeft / 7)} weeks left`;
  return "months left";
}

// A working check whose balance runs out within about a week becomes a warning.
// Down stays down: running out entirely is already an outage.
export function withRunningLowForecast(
  checkResult: DependencyCheckResult,
  earlierReadingsNewestFirst: LimitReading[],
  nowMilliseconds: number,
): DependencyCheckResult {
  if (checkResult.limitRemaining === null) return checkResult;
  const daysLeft = daysLeftAtRecentPace(checkResult.limitRemaining, earlierReadingsNewestFirst, nowMilliseconds);
  const forecast = `${formatAmount(checkResult.limitRemaining)} ${checkResult.limitUnit ?? "left"}, ${describeDaysLeft(daysLeft)}`;
  if (checkResult.status !== "working") return { ...checkResult, note: forecast };
  if (daysLeft !== null && daysLeft <= RUNNING_LOW_WITHIN_DAYS) {
    return {
      ...checkResult,
      status: "warning",
      failureKind: "running_low",
      failureDetail: `${forecast} at this week's pace`,
      note: forecast,
    };
  }
  return { ...checkResult, note: forecast };
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? amount.toLocaleString("en-US") : amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
