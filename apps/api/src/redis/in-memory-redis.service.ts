import type { Redis } from 'ioredis';
import { RedisPipeline, RedisService, RedisStatus } from './redis.service';

/**
 * How often the active expiry sweep runs. Real Redis pairs lazy (on-access) expiry with an
 * active cycle precisely because lazy expiry alone cannot collect a key nobody reads again;
 * this is that cycle. 30s keeps the reclaim latency well under the shortest TTL we set (the
 * push-scheduler lock, REFRESH_INTERVAL_SECONDS) while sweeping rarely enough to be free.
 */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * In-memory backing for the RedisService seam, used when Redis is explicitly
 * disabled (single-node mode). Faithful for the command subset NodeScope uses:
 * strings (get/set +EX/PX/NX), del, mget, sets, hashes and a small incr/expire
 * pipeline. Everything is process-local - correct precisely because single-node
 * means one process.
 *
 * Expiry is BOTH lazy (evaluated against Date.now() on access) and active (a periodic
 * sweep). The active sweep is not an optimisation, it is load-bearing: every key we set a
 * TTL on is time-tagged (`ai:rate:hourly:<user>:2026-07-13T14`), so once its window rolls
 * over, nothing ever reads that key again - and a lazy-only expiry that fires on access can
 * never collect a key that is never accessed. Those keys accumulated for the life of the
 * process, so a long-running appliance leaked one entry per user per hour, forever.
 */
export class InMemoryRedisService extends RedisService {
  readonly enabled = false;

  private readonly clusterMode: boolean;
  private readonly strings = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly hashes = new Map<string, Map<string, string>>();
  /** epoch ms, for a key of ANY type. Absent = no expiry. */
  private readonly expiries = new Map<string, number>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(clusterMode = false) {
    super();
    this.clusterMode = clusterMode;
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Never hold the event loop open on our account: this is a cache, not work.
    this.sweepTimer.unref?.();
  }

  /** Drop every key whose TTL has elapsed. Bounded by the number of keys carrying a TTL. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.expiries) {
      if (expiresAt <= now) this.drop(key);
    }
  }

  /** Remove a key from every type map and from the expiry index. */
  private drop(key: string): void {
    this.strings.delete(key);
    this.sets.delete(key);
    this.hashes.delete(key);
    this.expiries.delete(key);
  }

  /**
   * Lazy expiry: drop `key` if its TTL has elapsed. Returns true if the key is now gone.
   * Every accessor funnels through this so a read can never observe an expired key, even
   * in the window before the next sweep.
   */
  private reap(key: string): boolean {
    const expiresAt = this.expiries.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt > Date.now()) return false;
    this.drop(key);
    return true;
  }

  /** Returns the live string value, honouring the TTL. */
  private live(key: string): string | undefined {
    this.reap(key);
    return this.strings.get(key);
  }

  /** Does a key of any type currently exist (after expiry)? */
  private exists(key: string): boolean {
    this.reap(key);
    return this.strings.has(key) || this.sets.has(key) || this.hashes.has(key);
  }

  /** Total keys held. Exposed for tests/diagnostics - this is what leaked. */
  size(): number {
    return this.strings.size + this.sets.size + this.hashes.size;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key) ?? null;
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
    if (nx && this.live(key) !== undefined) return null;
    this.strings.set(key, String(value));
    // A SET without EX/PX clears any TTL the key was carrying, as in real Redis.
    if (expiresAt === null) this.expiries.delete(key);
    else this.expiries.set(key, expiresAt);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.exists(key)) removed++;
      this.drop(key);
    }
    return removed;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => this.live(key) ?? null);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.reap(key);
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
    this.reap(key);
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed++;
    }
    if (set.size === 0) this.drop(key);
    return removed;
  }

  async scard(key: string): Promise<number> {
    this.reap(key);
    return this.sets.get(key)?.size ?? 0;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    this.reap(key);
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
    this.reap(key);
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    let removed = 0;
    for (const field of fields) {
      if (hash.delete(field)) removed++;
    }
    if (hash.size === 0) this.drop(key);
    return removed;
  }

  async hdelIfValues(key: string, entries: Array<[string, string]>): Promise<number> {
    this.reap(key);
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    let removed = 0;
    for (const [field, observedValue] of entries) {
      if (hash.get(field) === observedValue && hash.delete(field)) removed++;
    }
    if (hash.size === 0) this.drop(key);
    return removed;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.reap(key);
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash);
  }

  async scan(
    _cursor: string,
    _matchToken: 'MATCH',
    pattern: string,
    _countToken: 'COUNT',
    _count: number,
  ): Promise<[string, string[]]> {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    const keys = new Set([
      ...this.strings.keys(),
      ...this.sets.keys(),
      ...this.hashes.keys(),
    ]);
    return ['0', [...keys].filter((key) => matcher.test(key)).sort()];
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
    const current = this.live(key);
    const parsed = current !== undefined ? parseInt(current, 10) : 0;
    const next = (Number.isNaN(parsed) ? 0 : parsed) + increment;
    // Leaves this.expiries untouched, so INCR keeps the key's existing TTL.
    this.strings.set(key, String(next));
    return next;
  }

  /** EXPIRE applies to a key of any type, so a TTL'd set/hash is collectable too. */
  private expire(key: string, seconds: number): number {
    if (!this.exists(key)) return 0;
    this.expiries.set(key, Date.now() + seconds * 1000);
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
    clearInterval(this.sweepTimer);
    this.strings.clear();
    this.sets.clear();
    this.hashes.clear();
    this.expiries.clear();
  }
}
