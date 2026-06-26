/**
 * Wrap an async fetch so it returns a cached result and only re-fetches once `intervalMs`
 * has elapsed since the last successful fetch.
 *
 * Used to stop the agent re-syncing the full device list on every short probe cycle: the
 * list changes rarely, and each sync triggers server-side SNMP-credential decryption, so
 * it's fetched on the slower `syncIntervalMs` cadence instead of `probeIntervalMs`. A
 * failed fetch does NOT update the cache, so the next call retries immediately.
 *
 * Concurrent callers that arrive while a fetch is in flight share that one promise rather
 * than each launching their own — otherwise two overlapping probe cycles would both see
 * `primed === false` and fire two real syncs (two credential decrypts), defeating the cache.
 */
export function cachedFetch<T>(
  fetch: () => Promise<T>,
  intervalMs: number,
  now: () => number = () => Date.now(),
): () => Promise<T> {
  let cache: T;
  let primed = false;
  let lastAt = 0;
  let inflight: Promise<T> | null = null;
  return async () => {
    const t = now();
    if (primed && t - lastAt < intervalMs) return cache;
    if (inflight) return inflight; // a fetch is already running — join it
    inflight = (async () => {
      try {
        cache = await fetch();
        primed = true;
        lastAt = t;
        return cache;
      } finally {
        inflight = null; // clear on success AND failure (a failed fetch stays un-cached → retries)
      }
    })();
    return inflight;
  };
}
