import { InMemoryRedisService } from './in-memory-redis.service';
import { RealRedisService } from './real-redis.service';
import { RedisService } from './redis.service';

export interface RedisConfig {
  /** Undefined = Redis disabled (single-node, in-memory backing). */
  url?: string;
  /** When true the app MUST have a real Redis; refuses to boot otherwise. */
  clusterMode: boolean;
}

/**
 * Chooses the Redis backing. The in-memory backing is used ONLY when Redis is
 * explicitly disabled (no REDIS_URL) — never as a silent substitute for a Redis
 * that is configured. When CLUSTER_MODE is on, a missing REDIS_URL is fatal:
 * multiple replicas without a shared Redis would silently diverge (per-node rate
 * limits, split realtime rooms), so we fail closed at boot instead.
 */
export function createRedisService(config: RedisConfig): RedisService {
  if (config.clusterMode && !config.url) {
    throw new Error(
      'CLUSTER_MODE is enabled but REDIS_URL is not set. A multi-replica deployment ' +
        'requires a shared Redis; refusing to boot rather than run clustered without it. ' +
        'Set REDIS_URL, or unset CLUSTER_MODE to run single-node with the in-memory backing.',
    );
  }
  return config.url
    ? RealRedisService.fromUrl(config.url, config.clusterMode)
    : new InMemoryRedisService(config.clusterMode);
}

export function redisConfigFromEnv(): RedisConfig {
  const url = process.env.REDIS_URL && process.env.REDIS_URL.length > 0 ? process.env.REDIS_URL : undefined;
  const clusterMode = /^(true|1)$/i.test(process.env.CLUSTER_MODE ?? '');
  return { url, clusterMode };
}
