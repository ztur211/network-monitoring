import { InMemoryRedisService } from '../in-memory-redis.service';

/**
 * The in-memory backing used when Redis is explicitly disabled (single-node mode).
 * It must be behaviourally faithful for the subset of commands NodeScope uses so
 * every consumer works unchanged: string get/set (+EX/PX/NX), del, mget, sets
 * (sadd/srem/scard), hashes (hset/hdel/hgetall), and a small pipeline (incr/incrby/expire).
 */
describe('InMemoryRedisService', () => {
  let redis: InMemoryRedisService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-02T00:00:00Z'));
    redis = new InMemoryRedisService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports itself as disabled', () => {
    expect(redis.enabled).toBe(false);
    expect(redis.describe().mode).toBe('in-memory');
  });

  it('returns null for a missing key and the value after set', async () => {
    expect(await redis.get('missing')).toBeNull();
    expect(await redis.set('k', 'v')).toBe('OK');
    expect(await redis.get('k')).toBe('v');
  });

  it('expires a key after its EX ttl elapses', async () => {
    await redis.set('k', 'v', 'EX', 10);
    jest.advanceTimersByTime(9_000);
    expect(await redis.get('k')).toBe('v');
    jest.advanceTimersByTime(2_000);
    expect(await redis.get('k')).toBeNull();
  });

  it('honours NX: sets only when absent, returning OK / null', async () => {
    expect(await redis.set('lock', '1', 'EX', 30, 'NX')).toBe('OK');
    expect(await redis.set('lock', '2', 'EX', 30, 'NX')).toBeNull();
    expect(await redis.get('lock')).toBe('1');
    // once expired, NX can acquire again
    jest.advanceTimersByTime(31_000);
    expect(await redis.set('lock', '3', 'EX', 30, 'NX')).toBe('OK');
    expect(await redis.get('lock')).toBe('3');
  });

  it('deletes keys and reports the count removed', async () => {
    await redis.set('a', '1');
    await redis.set('b', '2');
    expect(await redis.del('a', 'b', 'missing')).toBe(2);
    expect(await redis.get('a')).toBeNull();
  });

  it('mget returns values and nulls in order', async () => {
    await redis.set('a', '1');
    await redis.set('c', '3');
    expect(await redis.mget('a', 'b', 'c')).toEqual(['1', null, '3']);
  });

  it('supports set membership: sadd / scard / srem', async () => {
    expect(await redis.sadd('s', 'x')).toBe(1);
    expect(await redis.sadd('s', 'x')).toBe(0); // already present
    await redis.sadd('s', 'y');
    expect(await redis.scard('s')).toBe(2);
    expect(await redis.srem('s', 'x')).toBe(1);
    expect(await redis.scard('s')).toBe(1);
  });

  it('supports hashes: hset / hgetall / hdel', async () => {
    await redis.hset('h', 'f1', 'v1');
    await redis.hset('h', 'f2', 'v2');
    expect(await redis.hgetall('h')).toEqual({ f1: 'v1', f2: 'v2' });
    expect(await redis.hdel('h', 'f1')).toBe(1);
    expect(await redis.hgetall('h')).toEqual({ f2: 'v2' });
  });

  it('hgetall returns an empty object for a missing hash', async () => {
    expect(await redis.hgetall('nope')).toEqual({});
  });

  it('runs a pipeline of incr/incrby/expire and applies them', async () => {
    const results = await redis
      .pipeline()
      .incr('counter')
      .incr('counter')
      .incrby('tokens', 5)
      .expire('counter', 3600)
      .exec();
    expect(await redis.get('counter')).toBe('2');
    expect(await redis.get('tokens')).toBe('5');
    // ioredis exec() resolves to [err, result] tuples
    expect(Array.isArray(results)).toBe(true);
    expect(results![0]).toEqual([null, 1]);
  });

  it('pipeline expire makes the key eventually expire', async () => {
    await redis.pipeline().incr('c').expire('c', 10).exec();
    expect(await redis.get('c')).toBe('1');
    jest.advanceTimersByTime(11_000);
    expect(await redis.get('c')).toBeNull();
  });

  it('answers ping with PONG', async () => {
    expect(await redis.ping()).toBe('PONG');
  });
});
