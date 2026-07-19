/**
 * Runs ONCE before the e2e run, ahead of any worker.
 *
 * Why: the auth throttler stores its counters in Redis. In CI every job gets a fresh
 * `redis` service container, so the counters always start empty. Locally the same
 * container is reused across runs (and shared with the integration tier), so the
 * counters accumulate: a full e2e run exhausts the per-IP sign-up/sign-in budget and
 * every subsequent run mass-fails with 429 (`retry-after-auth` ~10 min) until the keys
 * expire. That looks exactly like a broken app, but it is stale test state.
 *
 * Clearing it here makes a local run start from the same blank slate CI gets.
 */
import IORedis from 'ioredis';

// The e2e stack's Redis (docker-compose.test.yml maps it to 6380). Flushing is
// destructive, so refuse to run against anything that isn't demonstrably that
// throwaway instance - a mistyped REDIS_URL must never wipe a real database.
const TEST_REDIS_PORTS = new Set(['6380']);

export default async function globalSetup(): Promise<void> {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6380';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return; // Not a URL we understand; leave it alone.
  }

  const isLocal = ['localhost', '127.0.0.1', '::1', 'redis-test'].includes(parsed.hostname);
  if (!isLocal || !TEST_REDIS_PORTS.has(parsed.port)) {
    console.warn(
      `[e2e globalSetup] REDIS_URL=${url} is not the recognised test instance; ` +
        'skipping the flush. Stale throttle counters may cause 429 failures.',
    );
    return;
  }

  const redis = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
  } catch (error) {
    // Redis being unreachable is the suites' problem to report, not this hook's.
    console.warn(`[e2e globalSetup] could not flush test Redis: ${(error as Error).message}`);
  } finally {
    redis.disconnect();
  }
}
