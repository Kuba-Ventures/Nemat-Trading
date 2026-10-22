import { test } from "node:test";
import assert from "node:assert/strict";
import type { StoredAiServiceCheck } from "./aiHealthAlerts";
import {
  buildAiHealthReport,
  incidentsFromChecks,
  timelineSlotsForChecks,
  uptimePercentForChecks,
  type StoredAiServiceCheckWithLatency,
} from "./aiHealthSummary";

function check(checkedAt: string, status: StoredAiServiceCheck["status"]): StoredAiServiceCheckWithLatency {
  return {
    service: "claude",
    status,
    failureKind: status === "down" ? "out_of_credits" : null,
    failureDetail: null,
    checkedAt,
    alertSent: null,
    latencyMilliseconds: 400,
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
});

test("an incident with no working check after it is still ongoing", () => {
  assert.equal(incidentsFromChecks(checksNewestFirst.slice(1))[0].endedAtIso, null);
});

test("uptime ignores checks that could not tell either way", () => {
  assert.equal(uptimePercentForChecks(checksNewestFirst), 50);
  assert.equal(uptimePercentForChecks([check("2026-10-21T23:30:00.000Z", "unknown")]), null);
});

test("a timeline slot with any failed check shows as down", () => {
  const slots = timelineSlotsForChecks(
    checksNewestFirst,
    Date.parse("2026-10-21T22:00:00.000Z"),
    Date.parse("2026-10-22T02:00:00.000Z"),
    4,
  );
  assert.deepEqual(slots, ["no_data", "down", "no_data", "down"]);
});

test("the report counts services down now and lists ongoing incidents with their duration", () => {
  const report = buildAiHealthReport(
    { claude: checksNewestFirst.slice(1), removebg: [] },
    Date.parse("2026-10-22T02:10:00.000Z"),
  );
  assert.equal(report.downCount, 1);
  const claude = report.services.find((s) => s.service === "claude")!;
  assert.equal(claude.currentFailureSummary, "the credit balance is too low");
  assert.equal(report.services.find((s) => s.service === "removebg")!.currentStatus, "never_checked");
  assert.equal(report.incidentsNewestFirst[0].endedAtIso, null);
  assert.equal(report.incidentsNewestFirst[0].durationText, "2 hours 20 minutes");
});
