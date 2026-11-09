// Keeps carrier status fresh for the admin shipping view: every 30 minutes,
// refreshes any order still on its way whose status is more than 3 hours old.
// One Shippo tracking call per stale order, so this stays tiny at our volume.

import { refreshStaleTracking } from "./fulfilment";

const CHECK_EVERY_MS = 30 * 60 * 1000;

export function startTrackingScheduler(): void {
  if (!process.env.SHIPPO_API_TOKEN) {
    console.log("[tracking] SHIPPO_API_TOKEN not set; carrier status refresh is off");
    return;
  }
  const run = () =>
    refreshStaleTracking()
      .then((n) => n > 0 && console.log(`[tracking] refreshed ${n} order(s)`))
      .catch((err) => console.error("[tracking] refresh run failed:", err));
  setTimeout(run, 60_000).unref?.();
  setInterval(run, CHECK_EVERY_MS).unref?.();
}
