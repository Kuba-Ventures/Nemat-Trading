// In-memory cache for the admin dashboards that remembers when each value was
// fetched, so the page can show the real sync time of every source.
//
// A forced load ("Sync now") skips the cache, except when the value is younger
// than minForceMs: repeated clicks then reuse it instead of hammering Stripe,
// Meta or GA4.

export type Synced<T> = { value: T; at: number };

export function createSyncCache(ttlMs: number, minForceMs: number, now: () => number = Date.now) {
  const entries = new Map<string, Synced<unknown>>();

  return async function get<T>(key: string, load: () => Promise<T>, force = false): Promise<Synced<T>> {
    const hit = entries.get(key) as Synced<T> | undefined;
    if (hit) {
      const age = now() - hit.at;
      if (age < (force ? minForceMs : ttlMs)) return hit;
    }
    const value = await load();
    const entry = { value, at: now() };
    entries.set(key, entry);
    return entry;
  };
}
