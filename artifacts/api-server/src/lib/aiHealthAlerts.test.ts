import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiHealthAlertRecipients,
  aiHealthPageUrl,
  buildAiServiceAlertEmail,
  decideAiServiceAlert,
  describeDowntime,
  downSinceForIncident,
  type StoredAiServiceCheck,
} from "./aiHealthAlerts";
import { classifyAnthropicFailure, classifyRemoveBgAccount } from "./aiHealthChecks";

function storedCheck(overrides: Partial<StoredAiServiceCheck> = {}): StoredAiServiceCheck {
  return {
    service: "claude",
    status: "working",
    failureKind: null,
    failureDetail: null,
    checkedAt: "2026-10-21T23:40:00.000Z",
    alertSent: null,
    ...overrides,
  };
}

test("running out of credits alerts on the first failed check", () => {
  assert.equal(decideAiServiceAlert({ status: "down", failureKind: "out_of_credits" }, [storedCheck()]), "down");
});

test("a one-off outage blip waits for a second failed check before alerting", () => {
  assert.equal(decideAiServiceAlert({ status: "down", failureKind: "provider_outage" }, [storedCheck()]), null);
  assert.equal(
    decideAiServiceAlert({ status: "down", failureKind: "provider_outage" }, [
      storedCheck({ status: "down", failureKind: "provider_outage" }),
      storedCheck(),
    ]),
    "down",
  );
});

test("an incident is only alerted once while it lasts", () => {
  const alertKind = decideAiServiceAlert({ status: "down", failureKind: "out_of_credits" }, [
    storedCheck({ status: "down", failureKind: "out_of_credits" }),
    storedCheck({ status: "down", failureKind: "out_of_credits", alertSent: "down" }),
    storedCheck(),
  ]);
  assert.equal(alertKind, null);
});

test("recovery is alerted only when a down alert went out for that incident", () => {
  assert.equal(
    decideAiServiceAlert({ status: "working", failureKind: null }, [
      storedCheck({ status: "down", failureKind: "out_of_credits", alertSent: "down" }),
      storedCheck(),
    ]),
    "recovered",
  );
  assert.equal(
    decideAiServiceAlert({ status: "working", failureKind: null }, [
      storedCheck({ status: "down", failureKind: "provider_outage" }),
      storedCheck(),
    ]),
    null,
  );
});

test("an earlier incident's alert does not silence a new incident", () => {
  const alertKind = decideAiServiceAlert({ status: "down", failureKind: "key_rejected" }, [
    storedCheck(),
    storedCheck({ status: "down", failureKind: "out_of_credits", alertSent: "down" }),
  ]);
  assert.equal(alertKind, "down");
});

test("an unknown check never alerts", () => {
  assert.equal(decideAiServiceAlert({ status: "unknown", failureKind: "not_configured" }, []), null);
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

test("Anthropic's credit balance error is recognised", () => {
  const failureKind = classifyAnthropicFailure(400, {
    error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
  });
  assert.equal(failureKind, "out_of_credits");
  assert.equal(classifyAnthropicFailure(401, { error: { type: "authentication_error" } }), "key_rejected");
  assert.equal(classifyAnthropicFailure(529, { error: { type: "overloaded_error" } }), "provider_outage");
  assert.equal(classifyAnthropicFailure(429, null), "rate_limited");
});

test("remove.bg is down under one credit, and a rejected key is down", () => {
  const account = (total: number) => ({ data: { attributes: { credits: { total }, api: { free_calls: 50 } } } });
  assert.deepEqual(classifyRemoveBgAccount(200, account(12)), { status: "working", failureKind: null });
  assert.deepEqual(classifyRemoveBgAccount(200, account(0.25)), { status: "down", failureKind: "out_of_credits" });
  assert.deepEqual(classifyRemoveBgAccount(402, null), { status: "down", failureKind: "out_of_credits" });
  assert.deepEqual(classifyRemoveBgAccount(403, { errors: [{ title: "API Key invalid" }] }), {
    status: "down",
    failureKind: "key_rejected",
  });
  assert.deepEqual(classifyRemoveBgAccount(200, {}), { status: "unknown", failureKind: "cannot_check" });
});

test("the down email says what broke and who can fix it, without dashes", () => {
  const alertEmail = buildAiServiceAlertEmail({
    alertKind: "down",
    service: "claude",
    failureKind: "out_of_credits",
    failureDetail: "400: Your credit balance is too low",
    downSinceIso: "2026-10-21T23:45:00.000Z",
    nowIso: "2026-10-21T23:45:00.000Z",
    healthPageUrl: "https://tommytopdecker.com/admin?view=health",
  });
  assert.equal(alertEmail.subject, "Tommy Top Decker: Claude is down, the credit balance is too low");
  assert.match(alertEmail.text, /intel report/);
  assert.match(alertEmail.text, /Console > Billing/);
  assert.match(alertEmail.html, /admin\?view=health/);
  assert.doesNotMatch(alertEmail.text + alertEmail.subject, /\u2014|\u2013/);
});

test("the recovered email says how long it was down", () => {
  const alertEmail = buildAiServiceAlertEmail({
    alertKind: "recovered",
    service: "removebg",
    failureKind: null,
    failureDetail: null,
    downSinceIso: "2026-10-21T23:45:00.000Z",
    nowIso: "2026-10-22T01:05:00.000Z",
    healthPageUrl: "https://tommytopdecker.com/admin?view=health",
  });
  assert.equal(alertEmail.subject, "Tommy Top Decker: remove.bg is working again");
  assert.match(alertEmail.text, /down for 1 hour 20 minutes/);
});

test("alerts only go to team addresses, defaulting to Finley", () => {
  assert.deepEqual(aiHealthAlertRecipients("finley@qsbsrollover.com, tommy@example.com"), ["finley@qsbsrollover.com"]);
  assert.deepEqual(aiHealthAlertRecipients(undefined), ["finley@qsbsrollover.com"]);
});

test("the email links to the Health view on the primary site", () => {
  assert.equal(
    aiHealthPageUrl("https://tommytopdecker.com/, https://www.tommytopdecker.com"),
    "https://tommytopdecker.com/admin?view=health",
  );
});
