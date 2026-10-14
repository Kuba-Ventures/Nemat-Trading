// Status for the "Live, synced 8:26:24 AM" pill on the admin Finance and
// Growth pages. Pure so it can be unit tested; the page re-runs it on a timer.

export const SYNC_POLL_MS = 60_000;
// Two missed polls: the data is no longer live.
export const SYNC_STALE_MS = 2 * 60_000;

export type SyncSource = "stripe" | "meta" | "ga4";

const NAMES: Record<SyncSource, string> = { stripe: "Stripe", meta: "Meta", ga4: "GA4" };

export type SyncInput = {
  // When each source was last fetched; null when not configured or it failed.
  synced: Partial<Record<SyncSource, string | null>>;
  // Sources whose block came back { ok: false }.
  failed: SyncSource[];
  // The last request to the API failed outright (the page keeps the old data).
  requestFailed: boolean;
};

export type SyncStatus = {
  state: "live" | "stale" | "error";
  label: string; // e.g. "Live, synced 8:26:24 AM"
  detail: string; // one line per source, for the hover title
};

export const clockTime = (iso: string | number) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function syncStatus(input: SyncInput, now: number): SyncStatus {
  const times = Object.values(input.synced).filter((t): t is string => !!t).map((t) => Date.parse(t));
  // The oldest source decides: the pill never claims fresher data than it shows.
  const oldest = times.length ? Math.min(...times) : null;
  const at = oldest == null ? "" : `, synced ${clockTime(oldest)}`;

  const detail = (Object.keys(NAMES) as SyncSource[])
    .filter((s) => s in input.synced || input.failed.includes(s))
    .map((s) => {
      if (input.failed.includes(s)) return `${NAMES[s]}: failed`;
      const t = input.synced[s];
      return `${NAMES[s]}: ${t ? clockTime(t) : "not connected"}`;
    })
    .concat(`Syncs every ${SYNC_POLL_MS / 1000}s while this tab is open.`)
    .join("\n");

  if (input.requestFailed) return { state: "error", label: `Sync failed${at}`, detail };
  if (input.failed.length) {
    const names = input.failed.map((s) => NAMES[s]).join(" and ");
    return { state: "error", label: `${names} failed${at}`, detail };
  }
  if (oldest == null) return { state: "stale", label: "Not synced yet", detail };
  if (now - oldest > SYNC_STALE_MS) return { state: "stale", label: `Stale${at}`, detail };
  return { state: "live", label: `Live${at}`, detail };
}
