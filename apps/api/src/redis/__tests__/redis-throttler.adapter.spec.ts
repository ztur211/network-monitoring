import { RedisThrottlerStorage } from '../redis-throttler.adapter';
import { RedisService } from '../redis.service';

/**
 * Unit tests for the Redis-backed throttler storage. The Lua script runs inside Redis (covered
 * by the integration suite); here we verify the JS wrapper: key prefixing, the args passed to
 * eval, the ThrottlerStorageRecord mapping, the non-positive-pttl guard, and fail-open on error.
 */
describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;
  let redis: { eval: jest.Mock };

  beforeEach(() => {
    redis = { eval: jest.fn() };
    storage = new RedisThrottlerStorage(redis as unknown as RedisService);
  });

  it('prefixes the key and passes ttl/limit/blockDuration to a single eval', async () => {
    redis.eval.mockResolvedValue([3, 45_000]);
    const rec = await storage.increment('tracker:default', 60_000, 100, 60_000, 'default');

    expect(rec).toEqual({ totalHits: 3, timeToExpire: 45, isBlocked: false, timeToBlockExpire: 0 });
    const [script, numKeys, key, ttl, limit, block] = redis.eval.mock.calls[0];
    expect(numKeys).toBe(1);
    expect(key).toBe('nodescope:throttle:tracker:default');
    expect(ttl).toBe(60_000);
    expect(limit).toBe(100);
    expect(block).toBe(60_000);
    expect(String(script)).toContain('INCR');
  });

  it('flags isBlocked + timeToBlockExpire once hits exceed the limit', async () => {
    redis.eval.mockResolvedValue([101, 58_000]);
    const rec = await storage.increment('k', 60_000, 100, 60_000, 'default');

    expect(rec.isBlocked).toBe(true);
    expect(rec.totalHits).toBe(101);
    expect(rec.timeToExpire).toBe(58);
    expect(rec.timeToBlockExpire).toBe(58);
  });

  it('rounds timeToExpire up to whole seconds', async () => {
    redis.eval.mockResolvedValue([1, 1]); // 1ms pttl → 1s
    const rec = await storage.increment('k', 60_000, 100, 60_000, 'default');
    expect(rec.timeToExpire).toBe(1);
  });

  it('falls back to the configured ttl when pttl is non-positive', async () => {
    redis.eval.mockResolvedValue([1, -1]); // no expiry reported
    const rec = await storage.increment('k', 60_000, 100, 60_000, 'default');
    expect(rec.timeToExpire).toBe(60); // ceil(60000 / 1000)
  });

  it('fails open (allows the request, not blocked) when Redis errors', async () => {
    redis.eval.mockRejectedValue(new Error('redis down'));
    const rec = await storage.increment('k', 60_000, 100, 60_000, 'default');

    expect(rec).toEqual({ totalHits: 0, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
  });
});
