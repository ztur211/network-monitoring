/**
 * Run `fn` over `items` with at most `limit` in flight: a worker pool draining a queue.
 *
 * Reach for this instead of `Promise.all(items.map(fn))` whenever `items` comes from a query,
 * an upload or a device list - anywhere its length grows with usage. An unbounded Promise.all
 * over a few thousand rows fires a few thousand concurrent DB queries or sockets at once,
 * which does not just make that one request slow: it drains the shared connection pool, so
 * every OTHER request and background job starts failing on pool timeouts. The fan-out is the
 * outage.
 *
 * Note the bound is PER CALL, not per process. Two overlapping cycles each get `limit` workers
 * - see nonOverlapping for why that distinction has already bitten us once.
 */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

/** mapLimit for when you need the results back, in the original order. */
export async function mapLimitResults<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}
