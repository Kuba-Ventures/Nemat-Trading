import { afterEach, describe, expect, it } from "vitest";
import { fromDatetimeLocal, toDatetimeLocal } from "./datetime";

// Node re-reads TZ whenever it changes, so one process can walk every zone.
// Half-hour (Adelaide) and 45-minute (Kathmandu) offsets are in the list
// because they break naive offset arithmetic.
const ZONES: Array<[zone: string, shown: string]> = [
  ["UTC", "2026-09-10T11:59"],
  ["America/New_York", "2026-09-10T07:59"],
  ["America/Los_Angeles", "2026-09-10T04:59"],
  ["Europe/London", "2026-09-10T12:59"],
  ["Asia/Tokyo", "2026-09-10T20:59"],
  ["Australia/Adelaide", "2026-09-10T21:29"],
  ["Asia/Kathmandu", "2026-09-10T17:44"],
];

const DEADLINE = "2026-09-10T11:59:00.000Z";
const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("toDatetimeLocal", () => {
  it.each(ZONES)("shows local wall-clock time in %s", (zone, shown) => {
    process.env.TZ = zone;
    expect(toDatetimeLocal(DEADLINE)).toBe(shown);
  });

  it("returns an empty string for a missing or unparseable deadline", () => {
    expect(toDatetimeLocal(null)).toBe("");
    expect(toDatetimeLocal("")).toBe("");
    expect(toDatetimeLocal("not a date")).toBe("");
  });
});

describe("admin save round trip", () => {
  // The #86 bug: opening a product and pressing Save moved the deadline by the
  // browser's UTC offset, compounding on every save.
  it.each(ZONES)("does not drift across repeated saves in %s", (zone) => {
    process.env.TZ = zone;
    let stored: string | null = DEADLINE;
    for (let save = 0; save < 5; save++) {
      stored = fromDatetimeLocal(toDatetimeLocal(stored));
    }
    expect(stored).toBe(DEADLINE);
  });

  it("stores no deadline when the field is empty", () => {
    expect(fromDatetimeLocal("")).toBeNull();
  });
});
