import { useEffect, useState } from "react";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type TimeLeft = {
  /** Whole days remaining. Drops run on a 10-day window, so this is usually non-zero. */
  d: number;
  /** Hours within the current day, not the total hour count. */
  h: number;
  m: number;
  s: number;
  /** True once the deadline has passed. */
  done: boolean;
  /** Past the final day, where seconds stop being useful and days start. */
  isLong: boolean;
};

export function getTimeLeft(targetIso: string): TimeLeft {
  const diff = Math.max(0, new Date(targetIso).getTime() - Date.now());
  return {
    d: Math.floor(diff / DAY_MS),
    h: Math.floor((diff % DAY_MS) / HOUR_MS),
    m: Math.floor((diff % HOUR_MS) / MINUTE_MS),
    s: Math.floor((diff % MINUTE_MS) / SECOND_MS),
    done: diff === 0,
    isLong: diff >= DAY_MS,
  };
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Ticks a countdown, once per second only when seconds are on screen.
 *
 * Past 24 hours the display stops at minutes, so a per-second interval would
 * re-render every timer on the page ~86,000 times a day to change nothing. The
 * loop reschedules itself off the remaining time instead, and lands on the
 * 24-hour boundary exactly so the switch to seconds is not up to half a minute
 * late.
 */
export function useTimeLeft(targetIso: string): TimeLeft {
  const [time, setTime] = useState(() => getTimeLeft(targetIso));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      const next = getTimeLeft(targetIso);
      setTime(next);
      if (next.done) return;

      const remaining = new Date(targetIso).getTime() - Date.now();
      const untilFinalDay = remaining - DAY_MS;
      const delay = next.isLong
        ? Math.max(SECOND_MS, Math.min(30 * SECOND_MS, untilFinalDay))
        : SECOND_MS;

      timer = setTimeout(schedule, delay);
    };

    schedule();
    return () => clearTimeout(timer);
  }, [targetIso]);

  return time;
}
