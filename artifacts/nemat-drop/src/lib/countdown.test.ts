import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { getTimeLeft, pad, useTimeLeft } from "./countdown";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTimeLeft", () => {
  it("splits the remaining time into days and within-day parts", () => {
    const t = getTimeLeft(at(3 * DAY + 4 * HOUR + 5 * MINUTE + 6 * SECOND));
    expect(t).toEqual({ d: 3, h: 4, m: 5, s: 6, done: false, isLong: true });
  });

  it("is not long inside the final day", () => {
    const t = getTimeLeft(at(DAY - SECOND));
    expect(t).toMatchObject({ d: 0, h: 23, m: 59, s: 59, isLong: false, done: false });
  });

  it("is long at exactly 24 hours", () => {
    expect(getTimeLeft(at(DAY)).isLong).toBe(true);
  });

  it("clamps a past deadline to zero and reports done", () => {
    expect(getTimeLeft(at(-HOUR))).toEqual({ d: 0, h: 0, m: 0, s: 0, done: true, isLong: false });
  });
});

describe("pad", () => {
  it("zero-pads to two digits", () => {
    expect(pad(0)).toBe("00");
    expect(pad(7)).toBe("07");
    expect(pad(42)).toBe("42");
  });
});

describe("useTimeLeft", () => {
  it("ticks every second inside the final day", () => {
    const { result } = renderHook(() => useTimeLeft(at(10 * SECOND)));
    expect(result.current.s).toBe(10);
    act(() => void vi.advanceTimersByTime(SECOND));
    expect(result.current.s).toBe(9);
  });

  it("does not tick every second while more than a day remains", () => {
    const { result } = renderHook(() => useTimeLeft(at(2 * DAY)));
    const first = result.current;
    act(() => void vi.advanceTimersByTime(5 * SECOND));
    // Seconds aren't on screen past 24h, so no re-render should have happened.
    expect(result.current).toBe(first);
  });

  it("switches to seconds one tick past the 24-hour boundary, not up to 30s late", () => {
    const { result } = renderHook(() => useTimeLeft(at(DAY + 10 * SECOND)));
    expect(result.current.isLong).toBe(true);
    // Lands on exactly 24:00:00, which still reads as a full day.
    act(() => void vi.advanceTimersByTime(10 * SECOND));
    expect(result.current).toMatchObject({ d: 1, h: 0, m: 0, isLong: true });
    act(() => void vi.advanceTimersByTime(SECOND));
    expect(result.current).toMatchObject({ d: 0, h: 23, m: 59, s: 59, isLong: false });
  });

  it("stops at done and schedules nothing further", () => {
    const { result } = renderHook(() => useTimeLeft(at(2 * SECOND)));
    act(() => void vi.advanceTimersByTime(2 * SECOND));
    expect(result.current.done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
