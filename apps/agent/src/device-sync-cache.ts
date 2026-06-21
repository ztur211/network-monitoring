/**
 * Wrap an async fetch so it returns a cached result and only re-fetches once `intervalMs`
 * has elapsed since the last successful fetch.
 *
 * Used to stop the agent re-syncing the full device list on every short probe cycle: the
 * list changes rarely, and each sync triggers server-side SNMP-credential decryption, so
 * it's fetched on the slower `syncIntervalMs` cadence instead of `probeIntervalMs`. A
 * failed fetch does NOT update the cache, so the next call retries immediately.
 */
export function cachedFetch<T>(
  fetch: () => Promise<T>,
  intervalMs: number,
  now: () => number = () => Date.now(),
): () => Promise<T> {
  let cache: T;
  let primed = false;
  let lastAt = 0;
  return async () => {
    const t = now();
    if (primed && t - lastAt < intervalMs) return cache;
    cache = await fetch();
    primed = true;
    lastAt = t;
    return cache;
  };
}
