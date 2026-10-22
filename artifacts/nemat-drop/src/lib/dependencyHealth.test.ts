import { describe, expect, it } from "vitest";
import {
  CANT_CHECK_WHILE_API_DOWN,
  DEPENDENCIES,
  buildHealthViewModel,
  mapLines,
  type HealthReport,
  type ReportService,
} from "./dependencyHealth";

const now = Date.parse("2026-10-22T00:00:00.000Z");

function service(key: ReportService["service"], overrides: Partial<ReportService> = {}): ReportService {
  return {
    service: key,
    displayName: key,
    currentStatus: "working",
    lastCheckedAtIso: "2026-10-21T23:57:00.000Z",
    lastLatencyMilliseconds: 200,
    currentFailureSummary: null,
    currentFailureDetail: null,
    whatBreaksWhileDown: "customers can't pay at checkout",
    note: null,
    limitRemaining: null,
    limitUnit: null,
    uptimePercent: 100,
    timelineSlots: [],
    ...overrides,
  };
}

function report(overrides: Partial<Record<ReportService["service"], Partial<ReportService>>> = {}): HealthReport {
  return {
    generatedAt: "2026-10-22T00:00:00.000Z",
    windowStartIso: "2026-10-15T00:00:00.000Z",
    windowDays: 7,
    lastFullCheckAtIso: "2026-10-21T23:57:00.000Z",
    services: DEPENDENCIES.map((entry) => service(entry.key, overrides[entry.key])),
    incidentsNewestFirst: [],
    secrets: [{ label: "Stripe webhook secret", present: true, note: null }],
    downCount: 0,
    warningCount: 0,
  };
}

describe("dependency health view", () => {
  it("says everything works, with the last full check", () => {
    const model = buildHealthViewModel(report(), null, now);
    expect(model.banner.tone).toBe("ok");
    expect(model.banner.body).toBe("All 10 dependencies working. Last full check 3m ago.");
    expect(model.rows.find((row) => row.key === "stripe")?.primary).toBe("answered in 0.2s");
    expect(model.outcomes.map((outcome) => outcome.statusText)).toEqual(["working", "working", "working", "working"]);
  });

  it("shows remove.bg credits and how long they last, and warns when low", () => {
    const model = buildHealthViewModel(
      report({ removebg: { currentStatus: "warning", limitRemaining: 12, limitUnit: "credits", note: "12 credits, about 4 days left" } }),
      null,
      now,
    );
    const row = model.rows.find((entry) => entry.key === "removebg")!;
    expect(row.primary).toBe("12 credits");
    expect(row.secondary).toBe("about 4 days left");
    expect(model.banner.tone).toBe("warn");
    expect(model.banner.body).toContain("remove.bg has 12 credits, about 4 days left");
    expect(model.outcomes.find((outcome) => outcome.label === "Admin tools")?.statusText).toBe("running low");
  });

  it("names what customers can't do when a service is down", () => {
    const model = buildHealthViewModel(report({ stripe: { currentStatus: "down", currentFailureSummary: "the key was rejected" } }), null, now);
    expect(model.banner.tone).toBe("down");
    expect(model.banner.body).toContain("customers can't pay at checkout");
    expect(model.outcomes[0]).toEqual({ label: "Customers can't check out", status: "down", statusText: "down" });
    expect(model.badgeCount).toBe(1);
  });

  it("greys out everything behind the API when the API is down, not green or red", () => {
    const model = buildHealthViewModel(report(), "2026-10-21T23:36:00.000Z", now);
    expect(model.rows.find((row) => row.key === "api")?.status).toBe("down");
    expect(model.rows.find((row) => row.key === "api")?.primary).toBe("no answer for 24m");
    const behindApi = model.rows.filter((row) => row.key !== "api" && row.key !== "site");
    expect(behindApi.every((row) => row.status === "cant_check" && row.subtitle === CANT_CHECK_WHILE_API_DOWN)).toBe(true);
    expect(model.banner.headline).toBe("Railway API is down.");
    expect(model.outcomes.find((outcome) => outcome.label === "Browsing the shop")?.status).toBe("working");
    expect(model.outcomes[0].label).toBe("Customers can't check out");
    expect(model.secrets).toEqual([]);
  });

  it("an unchecked sheet is unknown and doesn't break the shipping outcome", () => {
    const model = buildHealthViewModel(report({ sheets: { currentStatus: "unknown", currentFailureSummary: "nothing has used it recently" } }), null, now);
    expect(model.rows.find((row) => row.key === "sheets")?.status).toBe("unknown");
    expect(model.outcomes.find((outcome) => outcome.label === "Shipping and email")?.statusText).toBe("working");
  });

  it("draws one line per dependency with a parent on the map", () => {
    const lines = mapLines(buildHealthViewModel(report(), null, now).rows);
    expect(lines).toHaveLength(DEPENDENCIES.length - 1);
    expect(lines.find((line) => line.key === "api")).toEqual({ key: "api", x1: 120, y1: 46, x2: 210, y2: 46 });
  });
});
