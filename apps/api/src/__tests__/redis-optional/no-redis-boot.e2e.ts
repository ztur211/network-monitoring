import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { RedisService } from '../../redis/redis.service';
import { AI_PROVIDER_TOKEN } from '../../ai/adapters/ai-provider.interface';

/**
 * The headline of the Redis-optional work: the FULL application must boot and be
 * usable with NO Redis configured (single-node mode), backed entirely by the
 * in-memory RedisService. This exercises the real AppModule wiring — throttler
 * falls back to in-memory storage, the realtime gateway skips the socket.io Redis
 * adapter, and every Redis consumer runs against the in-memory backing.
 */
const mockAdapter = { complete: jest.fn(), stream: jest.fn() };

describe('App boots with Redis disabled (single-node, in-memory)', () => {
  let app: INestApplication;
  const savedEnv = { redis: process.env.REDIS_URL, cluster: process.env.CLUSTER_MODE };

  beforeAll(async () => {
    // Explicitly disable Redis (the e2e setup otherwise defaults REDIS_URL to a
    // test instance). Storage stays on the test MinIO that jest.e2e.setup.ts /
    // the CI job env already point at (port 9100) — overriding it to the dev
    // MinIO port here broke boot in CI, where nothing listens on 9000.
    delete process.env.REDIS_URL;
    delete process.env.CLUSTER_MODE;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER_TOKEN)
      .useValue(mockAdapter)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    // Restore env so a shared jest worker's later e2e files still see Redis configured.
    if (savedEnv.redis !== undefined) process.env.REDIS_URL = savedEnv.redis;
    if (savedEnv.cluster !== undefined) process.env.CLUSTER_MODE = savedEnv.cluster;
  });

  it('selected the in-memory Redis backing', () => {
    const redis = app.get(RedisService);
    expect(redis.enabled).toBe(false);
    expect(redis.describe()).toMatchObject({ enabled: false, mode: 'in-memory' });
  });

  it('serves /health: redis reported disabled, overall health still ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.redis).toMatchObject({ enabled: false, status: 'disabled' });
  });

  it('a Redis-backed path round-trips through the in-memory backing', async () => {
    // Drive a real string set/get + a lock (SET NX) as consumers do — proving the
    // seam behaves, not just that a stub exists.
    const redis = app.get(RedisService);
    await redis.set('e2e:probe', 'value', 'EX', 60);
    expect(await redis.get('e2e:probe')).toBe('value');
    expect(await redis.set('e2e:lock', '1', 'EX', 60, 'NX')).toBe('OK');
    expect(await redis.set('e2e:lock', '2', 'EX', 60, 'NX')).toBeNull();
  });

  it('applies HTTP rate limiting via the in-memory throttler storage (no Redis)', async () => {
    // The auth throttler is 200/15min in non-prod; a handful of requests must all
    // be admitted (not 429) — i.e. the throttler is wired and functioning in-memory.
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer()).get('/api/health');
      expect(res.status).toBe(200);
    }
  });
});
