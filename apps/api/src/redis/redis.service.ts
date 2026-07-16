import type { Redis } from 'ioredis';

export type RedisMode = 'real' | 'in-memory';

/** Health/diagnostic snapshot of how Redis is wired for this process. */
export interface RedisStatus {
  enabled: boolean;
  mode: RedisMode;
  clusterMode: boolean;
}

/** The minimal chainable pipeline surface NodeScope uses (ai-rate-limiter). */
export interface RedisPipeline {
  incr(key: string): this;
  incrby(key: string, increment: number): this;
  expire(key: string, seconds: number): this;
  /** Resolves to ioredis-shaped [error, result] tuples (or null on empty). */
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

/**
 * The Redis seam. Injected everywhere Redis is used so the whole app runs against
 * either a real ioredis connection (multi-node) or an in-memory backing (single-node,
 * Redis explicitly disabled). Only the commands NodeScope actually uses are exposed;
 * adding a new command means adding it here so both backings stay in lock-step (and
 * tsc flags any consumer that reaches for an unsupported command).
 */
export abstract class RedisService {
  /** True when backed by a real Redis (REDIS_URL set); false for the in-memory backing. */
  abstract readonly enabled: boolean;

  abstract get(key: string): Promise<string | null>;
  abstract set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<'OK' | null>;
  abstract del(...keys: string[]): Promise<number>;
  abstract mget(...keys: string[]): Promise<Array<string | null>>;

  abstract sadd(key: string, ...members: string[]): Promise<number>;
  abstract srem(key: string, ...members: string[]): Promise<number>;
  abstract scard(key: string): Promise<number>;

  abstract hset(key: string, field: string, value: string): Promise<number>;
  abstract hdel(key: string, ...fields: string[]): Promise<number>;
  /** Atomically delete hash fields only if each still equals the caller's observed value. */
  abstract hdelIfValues(key: string, entries: Array<[field: string, value: string]>): Promise<number>;
  abstract hgetall(key: string): Promise<Record<string, string>>;

  abstract scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>;

  /** Runs a server-side Lua script (throttler storage). In-memory backing does not support it. */
  abstract eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;

  abstract pipeline(): RedisPipeline;
  abstract ping(): Promise<string>;

  /** A fresh connection for the socket.io pub/sub adapter. Real backing only. */
  abstract duplicate(): Redis;

  /** For /health + startup logging. */
  abstract describe(): RedisStatus;

  abstract onModuleDestroy(): void | Promise<void>;
}
