import { createRedisService, redisConfigFromEnv } from '../redis.provider';
import { InMemoryRedisService } from '../in-memory-redis.service';
import { RealRedisService } from '../real-redis.service';

describe('createRedisService', () => {
  it('REFUSES to boot when clusterMode is on but no REDIS_URL (fail-closed)', () => {
    expect(() => createRedisService({ clusterMode: true })).toThrow(/CLUSTER_MODE/);
  });

  it('uses the in-memory backing when Redis is disabled and not clustered', () => {
    const svc = createRedisService({ clusterMode: false });
    expect(svc).toBeInstanceOf(InMemoryRedisService);
    expect(svc.enabled).toBe(false);
    expect(svc.describe()).toEqual({ enabled: false, mode: 'in-memory', clusterMode: false });
  });

  it('uses the real backing when REDIS_URL is set', async () => {
    const svc = createRedisService({ url: 'redis://localhost:6379', clusterMode: false });
    expect(svc).toBeInstanceOf(RealRedisService);
    expect(svc.enabled).toBe(true);
    expect(svc.describe().mode).toBe('real');
    await svc.onModuleDestroy(); // close the connection so jest exits cleanly
  });

  it('never silently substitutes in-memory for a configured-but-clustered Redis', async () => {
    // clusterMode + url is fine (real); clusterMode + no url must throw, never fall back.
    const svc = createRedisService({ url: 'redis://localhost:6379', clusterMode: true });
    expect(svc).toBeInstanceOf(RealRedisService);
    await svc.onModuleDestroy();
    expect(() => createRedisService({ clusterMode: true })).toThrow();
  });
});

describe('redisConfigFromEnv', () => {
  const orig = { url: process.env.REDIS_URL, cluster: process.env.CLUSTER_MODE };
  afterEach(() => {
    process.env.REDIS_URL = orig.url;
    process.env.CLUSTER_MODE = orig.cluster;
  });

  it('reads REDIS_URL and parses CLUSTER_MODE truthiness', () => {
    process.env.REDIS_URL = 'redis://x:6379';
    process.env.CLUSTER_MODE = 'true';
    expect(redisConfigFromEnv()).toEqual({ url: 'redis://x:6379', clusterMode: true });

    delete process.env.REDIS_URL;
    process.env.CLUSTER_MODE = 'false';
    expect(redisConfigFromEnv()).toEqual({ url: undefined, clusterMode: false });
  });
});
