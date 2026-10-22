import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anAlertEmailWentOutSince,
  buildHealthDailyEmail,
  dailyEmailSubject,
  describeDowntime,
  downSinceForIncident,
  healthAlertRecipients,
  healthPageUrl,
  isOutageWorthReporting,
  isRecoveryAwaitingReport,
  isRunningLowWorthReporting,
  reportedIncidentTimes,
  type StoredDependencyCheck,
} from "./dependencyAlerts";

function storedCheck(overrides: Partial<StoredDependencyCheck> = {}): StoredDependencyCheck {
  return {
    service: "stripe",
    status: "working",
    failureKind: null,
    failureDetail: null,
    checkedAt: "2026-10-21T23:40:00.000Z",
    alertSent: null,
    ...overrides,
  };
}

test("a rejected key or no credit is worth reporting on the first failed check", () => {
  assert.equal(isOutageWorthReporting({ status: "down", failureKind: "key_rejected" }, [storedCheck()]), true);
  assert.equal(isOutageWorthReporting({ status: "down", failureKind: "out_of_credits" }, [storedCheck()]), true);
  assert.equal(isOutageWorthReporting({ status: "down", failureKind: "domain_not_verified" }, [storedCheck()]), true);
});

test("a one-off blip waits for a second failed check", () => {
  assert.equal(isOutageWorthReporting({ status: "down", failureKind: "provider_outage" }, [storedCheck()]), false);
  assert.equal(
    isOutageWorthReporting({ status: "down", failureKind: "unreachable" }, [storedCheck({ status: "down", failureKind: "unreachable" })]),
    true,
  );
});

test("unknown and working checks are never outages", () => {
  assert.equal(isOutageWorthReporting({ status: "unknown", failureKind: "not_configured" }, []), false);
  assert.equal(isOutageWorthReporting({ status: "working", failureKind: null }, []), false);
});

test("running low goes into the email whenever the service is in warning", () => {
  assert.equal(isRunningLowWorthReporting({ status: "warning" }), true);
  assert.equal(isRunningLowWorthReporting({ status: "working" }), false);
});

test("a recovery is reported only when the last email listed the outage", () => {
  assert.equal(
    isRecoveryAwaitingReport({ status: "working" }, [storedCheck({ status: "down", alertSent: "down" }), storedCheck()]),
    true,
  );
  assert.equal(isRecoveryAwaitingReport({ status: "working" }, [storedCheck({ status: "down" }), storedCheck()]), false);
  assert.equal(
    isRecoveryAwaitingReport({ status: "working" }, [storedCheck({ alertSent: "recovered" }), storedCheck({ status: "down", alertSent: "down" })]),
    false,
  );
  assert.equal(isRecoveryAwaitingReport({ status: "working" }, [storedCheck({ status: "warning", alertSent: "running_low" })]), false);
});

test("a recovery after today's email still waits for the next email", () => {
  const earlierNewestFirst = [
    storedCheck({ status: "working", checkedAt: "2026-10-22T18:00:00.000Z" }),
    storedCheck({ status: "down", checkedAt: "2026-10-22T17:50:00.000Z", alertSent: "down" }),
  ];
  assert.equal(isRecoveryAwaitingReport({ status: "working" }, earlierNewestFirst), true);
  const times = reportedIncidentTimes(earlierNewestFirst, "2026-10-23T16:00:00.000Z");
  assert.equal(times.recoveredAtIso, "2026-10-22T18:00:00.000Z");
});

test("the daily limit counts any email sent since the start of the Pacific day", () => {
  const checks = [storedCheck({ checkedAt: "2026-10-22T08:30:00.000Z", alertSent: "down" })];
  assert.equal(anAlertEmailWentOutSince(checks, "2026-10-22T07:00:00.000Z"), true);
  assert.equal(anAlertEmailWentOutSince(checks, "2026-10-23T07:00:00.000Z"), false);
  assert.equal(anAlertEmailWentOutSince([], "2026-10-22T07:00:00.000Z"), false);
});

test("the incident starts at its oldest failed check", () => {
  const downSince = downSinceForIncident(
    [
      storedCheck({ status: "down", checkedAt: "2026-10-21T23:50:00.000Z" }),
      storedCheck({ status: "down", checkedAt: "2026-10-21T23:45:00.000Z" }),
      storedCheck({ status: "working", checkedAt: "2026-10-21T23:40:00.000Z" }),
    ],
    "2026-10-22T00:00:00.000Z",
  );
  assert.equal(downSince, "2026-10-21T23:45:00.000Z");
});

test("downtime reads in hours and minutes", () => {
  assert.equal(describeDowntime("2026-10-21T23:45:00.000Z", "2026-10-22T01:05:00.000Z"), "1 hour 20 minutes");
  assert.equal(describeDowntime("2026-10-21T23:45:00.000Z", "2026-10-21T23:55:00.000Z"), "10 minutes");
});

test("one combined email lists outages, running low and recoveries, without dashes", () => {
  const email = buildHealthDailyEmail({
    outages: [{ service: "stripe", failureKind: "key_rejected", failureDetail: "401: Invalid API Key", downSinceIso: "2026-10-21T23:45:00.000Z" }],
    runningLow: [{ service: "removebg", failureDetail: "12 credits, about 4 days left at this week's pace" }],
    recoveries: [{ service: "shippo", downSinceIso: "2026-10-21T20:00:00.000Z", recoveredAtIso: "2026-10-21T21:00:00.000Z" }],
    healthPageUrl: "https://tommytopdecker.com/admin?view=health",
  });
  assert.equal(email.subject, "Tommy Top Decker: Stripe is down, the key was rejected");
  assert.match(email.text, /customers can't pay at checkout/);
  assert.match(email.text, /remove\.bg is running low: 12 credits/);
  assert.match(email.text, /Shippo is working again/);
  assert.match(email.text, /at most one of these emails a day/);
  assert.match(email.html, /admin\?view=health/);
  assert.doesNotMatch(email.text + email.subject, /\u2014|\u2013/);
});

test("the subject leads with the worst news", () => {
  assert.equal(dailyEmailSubject({ outages: [], runningLow: [{ service: "removebg", failureDetail: null }], recoveries: [] }), "Tommy Top Decker: remove.bg is running low");
  assert.equal(
    dailyEmailSubject({ outages: [], runningLow: [], recoveries: [{ service: "claude", downSinceIso: "x", recoveredAtIso: "x" }] }),
    "Tommy Top Decker: Claude is working again",
  );
});

test("alerts only go to team addresses, defaulting to Finley", () => {
  assert.deepEqual(healthAlertRecipients("finley@qsbsrollover.com, tommy@example.com"), ["finley@qsbsrollover.com"]);
  assert.deepEqual(healthAlertRecipients(undefined), ["finley@qsbsrollover.com"]);
});

test("the email links to the Health view on the primary site", () => {
  assert.equal(healthPageUrl("https://tommytopdecker.com/, https://www.tommytopdecker.com"), "https://tommytopdecker.com/admin?view=health");
});
