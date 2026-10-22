import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHealthReport,
  incidentsFromChecks,
  requiredSecretsPresence,
  timelineSlotsForChecks,
  uptimePercentForChecks,
  type StoredDependencyCheckWithDetails,
} from "./dependencySummary";
import type { DependencyKey } from "./dependencyChecks";

function check(checkedAt: string, status: StoredDependencyCheckWithDetails["status"]): StoredDependencyCheckWithDetails {
  return {
    service: "stripe",
    status,
    failureKind: status === "down" ? "key_rejected" : status === "warning" ? "running_low" : null,
    failureDetail: null,
    checkedAt,
    alertSent: null,
    latencyMilliseconds: 400,
    limitRemaining: null,
    limitUnit: null,
    note: null,
  };
}

const checksNewestFirst = [
  check("2026-10-22T02:00:00.000Z", "working"),
  check("2026-10-22T01:50:00.000Z", "down"),
  check("2026-10-21T23:50:00.000Z", "down"),
  check("2026-10-21T23:40:00.000Z", "working"),
  check("2026-10-21T23:30:00.000Z", "unknown"),
];

test("a run of failed checks becomes one incident that ends at the next working check", () => {
  const incidents = incidentsFromChecks(checksNewestFirst);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].startedAtIso, "2026-10-21T23:50:00.000Z");
  assert.equal(incidents[0].endedAtIso, "2026-10-22T02:00:00.000Z");
  assert.equal(incidentsFromChecks(checksNewestFirst.slice(1))[0].endedAtIso, null);
});

test("uptime ignores checks that could not tell either way, and running low counts as up", () => {
  assert.equal(uptimePercentForChecks(checksNewestFirst), 50);
  assert.equal(uptimePercentForChecks([check("2026-10-21T23:30:00.000Z", "warning")]), 100);
  assert.equal(uptimePercentForChecks([check("2026-10-21T23:30:00.000Z", "unknown")]), null);
});

test("a timeline slot shows the worst check in it", () => {
  const slots = timelineSlotsForChecks(
    [...checksNewestFirst, check("2026-10-21T22:30:00.000Z", "warning")],
    Date.parse("2026-10-21T22:00:00.000Z"),
    Date.parse("2026-10-22T02:00:00.000Z"),
    4,
  );
  assert.deepEqual(slots, ["warning", "down", "no_data", "down"]);
});

test("secrets are reported present or missing, never with their values", () => {
  const secrets = requiredSecretsPresence({ STRIPE_WEBHOOK_SECRET: "whsec_x", ADMIN_SECRET: "abc", ADMIN_PASSWORD: "" });
  assert.deepEqual(
    secrets.map((secret) => [secret.label, secret.present]),
    [
      ["Stripe webhook secret", true],
      ["Admin password", false],
      ["Admin secret", true],
      ["Label link secret", true],
      ["Sheets webhook secret", false],
    ],
  );
  assert.equal(secrets[3].note, "using the admin secret");
  assert.doesNotMatch(JSON.stringify(secrets), /whsec_x|abc/);
});

test("the report counts what is down and running low and lists every dependency", () => {
  const empty = {} as Record<DependencyKey, StoredDependencyCheckWithDetails[]>;
  const report = buildHealthReport(
    {
      ...empty,
      stripe: checksNewestFirst.slice(1),
      removebg: [{ ...check("2026-10-22T02:00:00.000Z", "warning"), service: "removebg" }],
    },
    [],
    Date.parse("2026-10-22T02:10:00.000Z"),
  );
  assert.equal(report.services.length, 10);
  assert.equal(report.downCount, 1);
  assert.equal(report.warningCount, 1);
  assert.equal(report.services.find((s) => s.service === "api")!.currentStatus, "never_checked");
  assert.equal(report.incidentsNewestFirst[0].durationText, "2 hours 20 minutes");
  assert.equal(report.lastFullCheckAtIso, "2026-10-22T02:00:00.000Z");
});
