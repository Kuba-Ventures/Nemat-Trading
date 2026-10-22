import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aDownEmailWentOutForThisServiceSince,
  alertEmailSubject,
  buildHealthAlertEmail,
  describeDowntime,
  downSinceForIncident,
  healthAlertRecipients,
  healthPageUrl,
  isOutageWorthReporting,
  isRecoveryAwaitingReport,
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

test("an outage already emailed gets no reminder while it lasts", () => {
  assert.equal(
    isOutageWorthReporting({ status: "down", failureKind: "key_rejected" }, [
      storedCheck({ status: "down", failureKind: "key_rejected" }),
      storedCheck({ status: "down", failureKind: "key_rejected", alertSent: "down", checkedAt: "2026-10-20T10:00:00.000Z" }),
      storedCheck(),
    ]),
    false,
  );
});

test("a new outage after a fix is reported again", () => {
  assert.equal(
    isOutageWorthReporting({ status: "down", failureKind: "key_rejected" }, [storedCheck(), storedCheck({ status: "down", alertSent: "down" })]),
    true,
  );
});

test("running low is never an email on its own, and it counts as fixed after a down", () => {
  assert.equal(isOutageWorthReporting({ status: "warning", failureKind: "running_low" }, []), false);
  assert.equal(
    isRecoveryAwaitingReport({ status: "warning" }, [storedCheck({ status: "down", failureKind: "out_of_credits", alertSent: "down" })]),
    true,
  );
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
});

test("a recovery's times run from the first failed check to the first working one", () => {
  const earlierNewestFirst = [
    storedCheck({ status: "working", checkedAt: "2026-10-22T18:00:00.000Z" }),
    storedCheck({ status: "down", checkedAt: "2026-10-22T17:50:00.000Z", alertSent: "down" }),
    storedCheck({ status: "down", checkedAt: "2026-10-22T17:40:00.000Z" }),
  ];
  assert.deepEqual(reportedIncidentTimes(earlierNewestFirst, "2026-10-22T18:10:00.000Z"), {
    downSinceIso: "2026-10-22T17:40:00.000Z",
    recoveredAtIso: "2026-10-22T18:00:00.000Z",
  });
});

test("a service that keeps flipping gets at most one down email per Pacific day", () => {
  const checks = [
    storedCheck({ checkedAt: "2026-10-22T09:00:00.000Z", alertSent: "recovered" }),
    storedCheck({ status: "down", checkedAt: "2026-10-22T08:30:00.000Z", alertSent: "down" }),
  ];
  assert.equal(aDownEmailWentOutForThisServiceSince(checks, "2026-10-22T07:00:00.000Z"), true);
  assert.equal(aDownEmailWentOutForThisServiceSince(checks, "2026-10-23T07:00:00.000Z"), false);
  assert.equal(aDownEmailWentOutForThisServiceSince([storedCheck({ alertSent: "recovered" })], "2026-10-21T07:00:00.000Z"), false);
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

test("services that change in the same run share one email, without dashes", () => {
  const email = buildHealthAlertEmail({
    outages: [{ service: "stripe", failureKind: "key_rejected", failureDetail: "401: Invalid API Key", downSinceIso: "2026-10-21T23:45:00.000Z" }],
    recoveries: [{ service: "shippo", downSinceIso: "2026-10-21T20:00:00.000Z", recoveredAtIso: "2026-10-21T21:00:00.000Z" }],
    healthPageUrl: "https://tommytopdecker.com/admin?view=health",
  });
  assert.equal(email.subject, "Tommy Top Decker: Stripe is down, the key was rejected");
  assert.match(email.text, /customers can't pay at checkout/);
  assert.match(email.text, /Shippo is working again/);
  assert.match(email.text, /only get an email when something goes down and another when it is fixed/);
  assert.doesNotMatch(email.text, /running low:/);
  assert.match(email.html, /admin\?view=health/);
  assert.doesNotMatch(email.text + email.subject, /\u2014|\u2013/);
});

test("the subject leads with what went down, then what was fixed", () => {
  assert.equal(
    alertEmailSubject({ outages: [], recoveries: [{ service: "claude", downSinceIso: "x", recoveredAtIso: "x" }] }),
    "Tommy Top Decker: Claude is working again",
  );
  assert.equal(
    alertEmailSubject({
      outages: [
        { service: "stripe", failureKind: "key_rejected", failureDetail: null, downSinceIso: "x" },
        { service: "db", failureKind: "unreachable", failureDetail: null, downSinceIso: "x" },
      ],
      recoveries: [],
    }),
    "Tommy Top Decker: 2 services are down",
  );
});

test("alerts only go to team addresses, defaulting to Finley", () => {
  assert.deepEqual(healthAlertRecipients("finley@qsbsrollover.com, tommy@example.com"), ["finley@qsbsrollover.com"]);
  assert.deepEqual(healthAlertRecipients(undefined), ["finley@qsbsrollover.com"]);
});

test("the email links to the Health view on the primary site", () => {
  assert.equal(healthPageUrl("https://tommytopdecker.com/, https://www.tommytopdecker.com"), "https://tommytopdecker.com/admin?view=health");
});
