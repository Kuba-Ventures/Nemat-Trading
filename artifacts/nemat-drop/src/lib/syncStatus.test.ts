import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncStatus } from "./syncStatus";

const at = (hms: string) => `2026-10-14T${hms}.000Z`;
const ms = (hms: string) => Date.parse(at(hms));

describe("syncStatus", () => {
  const tz = process.env.TZ;
  beforeEach(() => { process.env.TZ = "UTC"; });
  afterEach(() => { process.env.TZ = tz; });

  it("is live with the oldest source's exact time", () => {
    const s = syncStatus(
      { synced: { stripe: at("08:26:30"), meta: at("08:26:24"), ga4: at("08:26:28") }, failed: [], requestFailed: false },
      ms("08:27:00"),
    );
    expect(s.state).toBe("live");
    expect(s.label).toBe("Live, synced 8:26:24 AM");
    expect(s.detail).toContain("Meta: 8:26:24 AM");
  });

  it("goes stale after two minutes without a sync", () => {
    const s = syncStatus({ synced: { stripe: at("08:26:24") }, failed: [], requestFailed: false }, ms("08:28:25"));
    expect(s.state).toBe("stale");
    expect(s.label).toBe("Stale, synced 8:26:24 AM");
  });

  it("names the source that failed", () => {
    const s = syncStatus(
      { synced: { stripe: at("08:26:24"), meta: null, ga4: at("08:26:24") }, failed: ["meta"], requestFailed: false },
      ms("08:26:30"),
    );
    expect(s.state).toBe("error");
    expect(s.label).toBe("Meta failed, synced 8:26:24 AM");
    expect(s.detail).toContain("Meta: failed");
  });

  it("says the sync failed when the request itself fails", () => {
    const s = syncStatus({ synced: { stripe: at("08:26:24") }, failed: [], requestFailed: true }, ms("08:26:30"));
    expect(s.state).toBe("error");
    expect(s.label).toBe("Sync failed, synced 8:26:24 AM");
  });

  it("lists an unconfigured source as not connected", () => {
    const s = syncStatus({ synced: { stripe: at("08:26:24"), ga4: null }, failed: [], requestFailed: false }, ms("08:26:30"));
    expect(s.state).toBe("live");
    expect(s.detail).toContain("GA4: not connected");
  });
});
