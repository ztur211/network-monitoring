import type { Redis } from 'ioredis';
import { RedisPipeline, RedisService, RedisStatus } from './redis.service';

interface StringEntry {
  value: string;
  /** epoch ms, or null for no expiry */
  expiresAt: number | null;
}

/**
 * In-memory backing for the RedisService seam, used when Redis is explicitly
 * disabled (single-node mode). Faithful for the command subset NodeScope uses:
 * strings (get/set +EX/PX/NX), del, mget, sets, hashes and a small incr/expire
 * pipeline. Everything is process-local — correct precisely because single-node
 * means one process. TTLs are evaluated lazily against Date.now() on access.
 */
export class InMemoryRedisService extends RedisService {
  readonly enabled = false;

  private readonly clusterMode: boolean;
  private readonly strings = new Map<string, StringEntry>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly hashes = new Map<string, Map<string, string>>();

  constructor(clusterMode = false) {
    super();
    this.clusterMode = clusterMode;
  }

  /** Returns the live entry, deleting it first if its TTL has elapsed. */
  private live(key: string): StringEntry | undefined {
    const entry = this.strings.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.strings.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    let expiresAt: number | null = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const flag = String(args[i]).toUpperCase();
      if (flag === 'EX') expiresAt = Date.now() + Number(args[++i]) * 1000;
      else if (flag === 'PX') expiresAt = Date.now() + Number(args[++i]);
      else if (flag === 'NX') nx = true;
    }
    if (nx && this.live(key)) return null;
    this.strings.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      let existed = this.live(key) !== undefined;
      this.strings.delete(key);
      if (this.sets.delete(key)) existed = true;
      if (this.hashes.delete(key)) existed = true;
      if (existed) removed++;
    }
    return removed;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.live(key)?.value ?? null);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed++;
    }
    if (set.size === 0) this.sets.delete(key);
    return removed;
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    const isNew = !hash.has(field);
    hash.set(field, String(value));
    return isNew ? 1 : 0;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    let removed = 0;
    for (const field of fields) {
      if (hash.delete(field)) removed++;
    }
    if (hash.size === 0) this.hashes.delete(key);
    return removed;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash);
  }

  async eval(): Promise<unknown> {
    throw new Error('eval() is not supported by the in-memory Redis backing (Redis is disabled)');
  }

  pipeline(): RedisPipeline {
    const queued: Array<() => unknown> = [];
    const pipeline: RedisPipeline = {
      incr: (key) => {
        queued.push(() => this.incrBy(key, 1));
        return pipeline;
      },
      incrby: (key, increment) => {
        queued.push(() => this.incrBy(key, increment));
        return pipeline;
      },
      expire: (key, seconds) => {
        queued.push(() => this.expire(key, seconds));
        return pipeline;
      },
      exec: async () =>
        queued.map((op) => {
          try {
            return [null, op()] as [Error | null, unknown];
          } catch (err) {
            return [err as Error, null];
          }
        }),
    };
    return pipeline;
  }

  private incrBy(key: string, increment: number): number {
    const entry = this.live(key);
    const current = entry ? parseInt(entry.value, 10) : 0;
    const next = (Number.isNaN(current) ? 0 : current) + increment;
    this.strings.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  private expire(key: string, seconds: number): number {
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  duplicate(): Redis {
    throw new Error('duplicate() is not supported by the in-memory Redis backing (Redis is disabled)');
  }

  describe(): RedisStatus {
    return { enabled: false, mode: 'in-memory', clusterMode: this.clusterMode };
  }

  onModuleDestroy(): void {
    this.strings.clear();
    this.sets.clear();
    this.hashes.clear();
  }
}
