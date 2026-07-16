import { Logger } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';
import { RedisPipeline, RedisService, RedisStatus } from './redis.service';

const HDEL_IF_VALUES_SCRIPT = `
local removed = 0
for i = 1, #ARGV, 2 do
  if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then
    removed = removed + redis.call('HDEL', KEYS[1], ARGV[i])
  end
end
return removed
`;

/**
 * Real Redis backing: a thin, typed delegator over an ioredis client. Composition
 * (not `extends Redis`) keeps the exposed surface exactly the RedisService seam and
 * sidesteps ioredis's heavily-overloaded method signatures.
 *
 * Critically, the constructor registers an 'error' listener. ioredis connects eagerly
 * and emits 'error' on any connection blip; an EventEmitter 'error' with no listener is
 * re-thrown and crashes the process at boot. Registering the listener is the fix.
 */
export class RealRedisService extends RedisService {
  readonly enabled = true;
  private readonly logger = new Logger(RealRedisService.name);

  constructor(
    private readonly client: Redis,
    private readonly clusterMode: boolean = false,
  ) {
    super();
    this.client.on('error', (err: Error) => {
      // Log-and-swallow: consumers already fall back on a rejected command; the
      // listener's job is purely to stop a connection 'error' from crashing boot.
      this.logger.warn(`Redis connection error: ${err.message}`);
    });
  }

  /** Build from a URL — the module factory's entry point. */
  static fromUrl(url: string, clusterMode: boolean): RealRedisService {
    // maxRetriesPerRequest: null lets commands queue through a reconnect rather than
    // fail fast, matching the previous default RedisService behaviour.
    return new RealRedisService(new IORedis(url, { maxRetriesPerRequest: null }), clusterMode);
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    return (this.client.set as (...a: unknown[]) => Promise<'OK' | null>)(key, value, ...args);
  }

  del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  mget(...keys: string[]): Promise<Array<string | null>> {
    return this.client.mget(...keys);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value);
  }

  hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(key, ...fields);
  }

  async hdelIfValues(key: string, entries: Array<[string, string]>): Promise<number> {
    if (entries.length === 0) return 0;
    const result = await this.client.eval(HDEL_IF_VALUES_SCRIPT, 1, key, ...entries.flat());
    return Number(result);
  }

  hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]]> {
    return this.client.scan(cursor, matchToken, pattern, countToken, count);
  }

  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    return this.client.eval(script, numKeys, ...args);
  }

  pipeline(): RedisPipeline {
    return this.client.pipeline() as unknown as RedisPipeline;
  }

  ping(): Promise<string> {
    return this.client.ping();
  }

  duplicate(): Redis {
    const dup = this.client.duplicate();
    dup.on('error', (err: Error) => this.logger.warn(`Redis pub/sub connection error: ${err.message}`));
    return dup;
  }

  describe(): RedisStatus {
    return { enabled: true, mode: 'real', clusterMode: this.clusterMode };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
