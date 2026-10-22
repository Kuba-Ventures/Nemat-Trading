// Pure summary of stored checks for the admin Health and Map views: current
// status, a 7 day timeline, uptime and incidents per dependency. No I/O, so it
// is unit tested.

import {
  dependencyDisplayNames,
  dependencyFailureSummaries,
  describeDowntime,
  whatBreaksForUsers,
  type StoredDependencyCheck,
} from "./dependencyAlerts";
import { allDependencyKeys, type DependencyFailureKind, type DependencyKey, type DependencyStatus } from "./dependencyChecks";

export type TimelineSlot = "working" | "warning" | "down" | "no_data";

export type DependencyIncident = {
  startedAtIso: string;
  endedAtIso: string | null;
  failureKind: DependencyFailureKind | null;
  failureDetail: string | null;
};

export type StoredDependencyCheckWithDetails = StoredDependencyCheck & {
  latencyMilliseconds: number | null;
  limitRemaining: number | null;
  limitUnit: string | null;
  note: string | null;
};

export type DependencyHealthSummary = {
  service: DependencyKey;
  currentStatus: DependencyStatus | "never_checked";
  lastCheckedAtIso: string | null;
  lastLatencyMilliseconds: number | null;
  currentFailureKind: DependencyFailureKind | null;
  currentFailureDetail: string | null;
  note: string | null;
  limitRemaining: number | null;
  limitUnit: string | null;
  uptimePercent: number | null;
  timelineSlots: TimelineSlot[];
  incidentsNewestFirst: DependencyIncident[];
};

export const healthWindowDays = 7;
export const timelineSlotCount = 56;

const slotRank: Record<TimelineSlot, number> = { no_data: 0, working: 1, warning: 2, down: 3 };

export function timelineSlotsForChecks(
  checksNewestFirst: StoredDependencyCheck[],
  windowStartMilliseconds: number,
  windowEndMilliseconds: number,
  slotCount = timelineSlotCount,
): TimelineSlot[] {
  const slotLengthMilliseconds = (windowEndMilliseconds - windowStartMilliseconds) / slotCount;
  const timelineSlots: TimelineSlot[] = Array.from({ length: slotCount }, () => "no_data");
  for (const check of checksNewestFirst) {
    if (check.status === "unknown") continue;
    const checkedAtMilliseconds = Date.parse(check.checkedAt);
    if (checkedAtMilliseconds < windowStartMilliseconds || checkedAtMilliseconds > windowEndMilliseconds) continue;
    const slotIndex = Math.min(
      slotCount - 1,
      Math.floor((checkedAtMilliseconds - windowStartMilliseconds) / slotLengthMilliseconds),
    );
    const slot: TimelineSlot = check.status;
    if (slotRank[slot] > slotRank[timelineSlots[slotIndex]]) timelineSlots[slotIndex] = slot;
  }
  return timelineSlots;
}

export function incidentsFromChecks(checksNewestFirst: StoredDependencyCheck[]): DependencyIncident[] {
  const incidentsOldestFirst: DependencyIncident[] = [];
  let openIncident: DependencyIncident | null = null;
  for (const check of [...checksNewestFirst].reverse()) {
    if (check.status === "down" && openIncident === null) {
      openIncident = {
        startedAtIso: check.checkedAt,
        endedAtIso: null,
        failureKind: check.failureKind,
        failureDetail: check.failureDetail,
      };
      incidentsOldestFirst.push(openIncident);
    } else if ((check.status === "working" || check.status === "warning") && openIncident !== null) {
      openIncident.endedAtIso = check.checkedAt;
      openIncident = null;
    }
  }
  return incidentsOldestFirst.reverse();
}

export function uptimePercentForChecks(checksNewestFirst: StoredDependencyCheck[]): number | null {
  const conclusiveChecks = checksNewestFirst.filter((check) => check.status !== "unknown");
  if (conclusiveChecks.length === 0) return null;
  const upCheckCount = conclusiveChecks.filter((check) => check.status !== "down").length;
  return Math.round((upCheckCount / conclusiveChecks.length) * 1000) / 10;
}

export function summarizeDependencyHealth(
  service: DependencyKey,
  checksNewestFirst: StoredDependencyCheckWithDetails[],
  nowMilliseconds: number,
): DependencyHealthSummary {
  const latestCheck = checksNewestFirst[0] ?? null;
  const windowStartMilliseconds = nowMilliseconds - healthWindowDays * 24 * 60 * 60 * 1000;
  return {
    service,
    currentStatus: latestCheck?.status ?? "never_checked",
    lastCheckedAtIso: latestCheck?.checkedAt ?? null,
    lastLatencyMilliseconds: latestCheck?.latencyMilliseconds ?? null,
    currentFailureKind: latestCheck?.failureKind ?? null,
    currentFailureDetail: latestCheck?.failureDetail ?? null,
    note: latestCheck?.note ?? null,
    limitRemaining: latestCheck?.limitRemaining ?? null,
    limitUnit: latestCheck?.limitUnit ?? null,
    uptimePercent: uptimePercentForChecks(checksNewestFirst),
    timelineSlots: timelineSlotsForChecks(checksNewestFirst, windowStartMilliseconds, nowMilliseconds),
    incidentsNewestFirst: incidentsFromChecks(checksNewestFirst),
  };
}

// ─── Secrets present ─────────────────────────────────────────────────────────

export type SecretPresence = { label: string; present: boolean; note: string | null };

// Only whether each required secret exists. Values never leave the server.
export function requiredSecretsPresence(environment: Record<string, string | undefined> = process.env): SecretPresence[] {
  const isSet = (name: string) => !!environment[name]?.trim();
  const labelLinkNote = !isSet("LABEL_LINK_SECRET") && isSet("ADMIN_SECRET") ? "using the admin secret" : null;
  return [
    { label: "Stripe webhook secret", present: isSet("STRIPE_WEBHOOK_SECRET"), note: null },
    { label: "Admin password", present: isSet("ADMIN_PASSWORD"), note: null },
    { label: "Admin secret", present: isSet("ADMIN_SECRET"), note: null },
    { label: "Label link secret", present: isSet("LABEL_LINK_SECRET") || isSet("ADMIN_SECRET"), note: labelLinkNote },
    { label: "Sheets webhook secret", present: isSet("SHEETS_WEBHOOK_SECRET"), note: null },
  ];
}

// ─── The report the admin views read ─────────────────────────────────────────

export type HealthReportService = DependencyHealthSummary & {
  displayName: string;
  currentFailureSummary: string | null;
  whatBreaksWhileDown: string;
};

export type HealthReportIncident = DependencyIncident & {
  service: DependencyKey;
  displayName: string;
  failureSummary: string;
  durationText: string;
};

export type HealthReport = {
  generatedAt: string;
  windowStartIso: string;
  windowDays: number;
  lastFullCheckAtIso: string | null;
  services: HealthReportService[];
  incidentsNewestFirst: HealthReportIncident[];
  secrets: SecretPresence[];
  downCount: number;
  warningCount: number;
};

const maximumIncidentsListed = 20;

export function buildHealthReport(
  checksByService: Record<DependencyKey, StoredDependencyCheckWithDetails[]>,
  secrets: SecretPresence[],
  nowMilliseconds: number,
): HealthReport {
  const nowIso = new Date(nowMilliseconds).toISOString();
  const services = allDependencyKeys.map((service): HealthReportService => {
    const summary = summarizeDependencyHealth(service, checksByService[service] ?? [], nowMilliseconds);
    return {
      ...summary,
      displayName: dependencyDisplayNames[service],
      currentFailureSummary: summary.currentFailureKind ? dependencyFailureSummaries[summary.currentFailureKind] : null,
      whatBreaksWhileDown: whatBreaksForUsers[service],
    };
  });
  const incidentsNewestFirst = services
    .flatMap((serviceReport) =>
      serviceReport.incidentsNewestFirst.map(
        (incident): HealthReportIncident => ({
          ...incident,
          service: serviceReport.service,
          displayName: serviceReport.displayName,
          failureSummary: incident.failureKind ? dependencyFailureSummaries[incident.failureKind] : "it failed",
          durationText: describeDowntime(incident.startedAtIso, incident.endedAtIso ?? nowIso),
        }),
      ),
    )
    .sort((first, second) => Date.parse(second.startedAtIso) - Date.parse(first.startedAtIso))
    .slice(0, maximumIncidentsListed);
  const railwayCheckTimes = services
    .filter((serviceReport) => serviceReport.service !== "api" && serviceReport.lastCheckedAtIso)
    .map((serviceReport) => Date.parse(serviceReport.lastCheckedAtIso!));
  return {
    generatedAt: nowIso,
    windowStartIso: new Date(nowMilliseconds - healthWindowDays * 24 * 60 * 60 * 1000).toISOString(),
    windowDays: healthWindowDays,
    lastFullCheckAtIso: railwayCheckTimes.length ? new Date(Math.max(...railwayCheckTimes)).toISOString() : null,
    services,
    incidentsNewestFirst,
    secrets,
    downCount: services.filter((serviceReport) => serviceReport.currentStatus === "down").length,
    warningCount: services.filter((serviceReport) => serviceReport.currentStatus === "warning").length,
  };
}
