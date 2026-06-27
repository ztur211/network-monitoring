import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from './redis.service';

const KEY_PREFIX = 'nodescope:throttle:';

/**
 * Atomic fixed-window counter (with block support) evaluated in a single Lua call:
 *   KEYS[1] = counter key
 *   ARGV[1] = ttl (ms), ARGV[2] = limit, ARGV[3] = blockDuration (ms)
 *   returns { totalHits, pttl_ms }
 *
 * - First hit in a window arms the ttl.
 * - The hit that crosses the limit re-arms the key to blockDuration, so the block lasts
 *   blockDuration from the breach (mirrors @nestjs/throttler's in-memory blockExpiresAt).
 * - When the key's TTL lapses the next hit starts a fresh window — matching the in-memory reset.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
elseif hits == tonumber(ARGV[2]) + 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
end
local pttl = redis.call('PTTL', KEYS[1])
return { hits, pttl }
`;

/**
 * Redis-backed `ThrottlerStorage` for @nestjs/throttler. The default storage is an in-memory
 * Map, so each API node keeps its own counters — behind a load balancer with N nodes a client
 * effectively gets N× the configured limit, defeating the auth/abuse limits. This shares the
 * counters across nodes via the existing Redis connection.
 *
 * Fail-open: if Redis is unreachable, allow the request rather than 500 the whole API on a
 * throttle check. A rate limiter degrading to "unlimited" during a Redis outage is far better
 * than taking the service down; the outage itself is alarmed elsewhere (RedisService).
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `${KEY_PREFIX}${key}`;
    try {
      const result = (await this.redis.eval(
        INCREMENT_SCRIPT,
        1,
        redisKey,
        ttl,
        limit,
        blockDuration,
      )) as [number, number];
      const totalHits = Number(result[0]);
      const pttl = Number(result[1]);
      // pttl < 0 means "no expiry / missing" — a state the script shouldn't produce, but guard
      // so a stuck key can't report a negative/forever window.
      const timeToExpire = pttl > 0 ? Math.ceil(pttl / 1000) : Math.ceil(ttl / 1000);
      const isBlocked = totalHits > limit;
      return {
        totalHits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire: isBlocked ? timeToExpire : 0,
      };
    } catch (err) {
      this.logger.warn({ err, key }, 'Throttler Redis unavailable — allowing request (fail-open)');
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
