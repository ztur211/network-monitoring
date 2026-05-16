/**
 * Graceful degradation: backend-unreachable scenario (SAD Section 11.8)
 *
 * Verifies the health endpoint correctly reports degraded state when individual
 * services fail, so the frontend OfflineBanner gets accurate signal.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../../health/health.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

const mockPrisma = { $queryRaw: jest.fn() };
const mockRedis = { ping: jest.fn() };

describe('Graceful degradation — backend health under failure', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();
    controller = module.get(HealthController);
    jest.clearAllMocks();
  });

  it('returns status ok when both DB and Redis respond', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedis.ping.mockResolvedValue('PONG');

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.services.database).toBe('ok');
    expect(result.services.redis).toBe('ok');
  });

  it('returns status degraded when database is unreachable', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));
    mockRedis.ping.mockResolvedValue('PONG');

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.services.database).toBe('degraded');
    expect(result.services.redis).toBe('ok');
  });

  it('returns status degraded when Redis is unreachable', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedis.ping.mockRejectedValue(new Error('Redis ECONNREFUSED'));

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.services.database).toBe('ok');
    expect(result.services.redis).toBe('degraded');
  });

  it('returns status degraded when both services are unreachable', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'));
    mockRedis.ping.mockRejectedValue(new Error('Redis down'));

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.services.database).toBe('degraded');
    expect(result.services.redis).toBe('degraded');
  });

  it('returns a version string read from package.json', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedis.ping.mockResolvedValue('PONG');

    const result = await controller.check();

    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('includes ISO8601 timestamp in response', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedis.ping.mockResolvedValue('PONG');

    const result = await controller.check();

    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
