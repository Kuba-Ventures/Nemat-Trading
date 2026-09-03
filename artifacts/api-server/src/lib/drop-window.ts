/**
 * Drop deadlines run on a fixed, repeating window rather than a one-off date.
 * When a deadline lapses it rolls forward by whole windows until it is in the
 * future again, so a live drop never sits in an "expired" state waiting for
 * someone to edit it by hand.
 *
 * Rolling in whole windows (rather than resetting to "now + 10 days") keeps every
 * deadline on the schedule its original date established: a drop that lapsed
 * three days ago lands seven days out, not ten, and its deadlines stay on the
 * same clock face they started on.
 */
export const DEAL_WINDOW_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEAL_WINDOW_MS = DEAL_WINDOW_DAYS * DAY_MS;

/**
 * The deadline this product should be showing right now.
 *
 * Returns `expiresAt` unchanged when it is still in the future, so callers can
 * compare by value to decide whether a write is needed. A deadline falling
 * exactly on `now` counts as lapsed and rolls.
 */
export function currentWindowEnd(expiresAt: Date, now: Date): Date {
  const elapsed = now.getTime() - expiresAt.getTime();
  if (elapsed < 0) return expiresAt;
  const windows = Math.floor(elapsed / DEAL_WINDOW_MS) + 1;
  return new Date(expiresAt.getTime() + windows * DEAL_WINDOW_MS);
}
