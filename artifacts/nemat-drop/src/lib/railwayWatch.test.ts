import { describe, expect, it } from "vitest";
import {
  buildWatcherEmail,
  classifyRailwayObservation,
  decideWatcherEmail,
  downSince,
  startOfPacificDay,
  watcherRecipients,
  type WatcherRow,
} from "../../api/cron/watch-railway";

const now = new Date("2026-10-22T20:00:00.000Z");
const answered = { apiAnswered: true, apiHttpStatus: 200, apiError: null };

describe("outside Railway watcher", () => {
  it("is working when the API answers and checked recently", () => {
    expect(classifyRailwayObservation({ ...answered, newestRailwayCheckAtIso: "2026-10-22T19:52:00.000Z" }, now.getTime()).status).toBe("working");
  });

  it("is down when the API doesn't answer, or answers but stopped checking for 30 minutes", () => {
    expect(classifyRailwayObservation({ apiAnswered: false, apiHttpStatus: null, apiError: "fetch failed", newestRailwayCheckAtIso: null }, now.getTime()).failureKind).toBe("unreachable");
    expect(classifyRailwayObservation({ ...answered, apiHttpStatus: 502, newestRailwayCheckAtIso: null }, now.getTime()).failureKind).toBe("unreachable");
    expect(classifyRailwayObservation({ ...answered, newestRailwayCheckAtIso: "2026-10-22T19:20:00.000Z" }, now.getTime()).failureKind).toBe("checks_stopped");
    expect(classifyRailwayObservation({ ...answered, newestRailwayCheckAtIso: null }, now.getTime()).status).toBe("unknown");
  });

  const row = (checkedAt: string, status: WatcherRow["status"], alertSent: WatcherRow["alertSent"] = null): WatcherRow => ({ checkedAt, status, alertSent });
  const unreachable = { status: "down" as const, failureKind: "unreachable" as const, failureDetail: "fetch failed" };

  it("waits for a second unanswered run, but alerts at once when checks stopped", () => {
    expect(decideWatcherEmail(unreachable, [row("2026-10-22T19:50:00.000Z", "working")], now)).toBeNull();
    expect(decideWatcherEmail(unreachable, [row("2026-10-22T19:50:00.000Z", "down")], now)).toBe("down");
    expect(decideWatcherEmail({ status: "down", failureKind: "checks_stopped", failureDetail: null }, [], now)).toBe("down");
  });

  it("sends at most one email per Pacific day", () => {
    const earlier = [row("2026-10-22T19:50:00.000Z", "down"), row("2026-10-22T15:00:00.000Z", "down", "down")];
    expect(decideWatcherEmail(unreachable, earlier, now)).toBeNull();
    const yesterday = [row("2026-10-22T19:50:00.000Z", "down"), row("2026-10-21T15:00:00.000Z", "down", "down")];
    expect(decideWatcherEmail(unreachable, yesterday, now)).toBe("down");
  });

  it("reports a recovery only after a down email, and not twice in a day", () => {
    expect(decideWatcherEmail({ status: "working", failureKind: null, failureDetail: null }, [row("2026-10-21T19:50:00.000Z", "down", "down")], now)).toBe("recovered");
    expect(decideWatcherEmail({ status: "working", failureKind: null, failureDetail: null }, [row("2026-10-22T19:50:00.000Z", "down", "down")], now)).toBeNull();
    expect(decideWatcherEmail({ status: "working", failureKind: null, failureDetail: null }, [row("2026-10-22T19:50:00.000Z", "down")], now)).toBeNull();
  });

  it("finds when the outage started and the Pacific day boundary", () => {
    expect(downSince([row("2026-10-22T19:50:00.000Z", "down"), row("2026-10-22T19:40:00.000Z", "down"), row("2026-10-22T19:30:00.000Z", "working")], "x")).toBe("2026-10-22T19:40:00.000Z");
    expect(startOfPacificDay(now).toISOString()).toBe("2026-10-22T07:00:00.000Z");
    expect(startOfPacificDay(new Date("2026-12-01T20:00:00.000Z")).toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("only emails team addresses, and the email has no dashes", () => {
    expect(watcherRecipients("finley@qsbsrollover.com,patrick@example.com")).toEqual(["finley@qsbsrollover.com"]);
    expect(watcherRecipients(undefined)).toEqual(["finley@qsbsrollover.com"]);
    const email = buildWatcherEmail({ alertKind: "down", result: unreachable, downSinceIso: "2026-10-22T19:40:00.000Z", nowIso: now.toISOString(), healthPageUrl: "https://tommytopdecker.com/admin?view=health" });
    expect(email.subject).toBe("Tommy Top Decker: the Railway API server is down, customers can't check out");
    expect(email.text).toMatch(/outside check on Vercel/);
    expect(email.text + email.subject).not.toMatch(/\u2014|\u2013/);
  });
});
