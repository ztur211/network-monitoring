import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { DataSourcesRepository } from '../data-sources.repository';

// Integration tests — run against real test DB
// Run with: npm run test:integration --workspace=apps/api

const ORG_A = 'test-ds-org-a';
const ORG_B = 'test-ds-org-b';
const USER_A = 'test-datasources-user';
const USER_B = 'test-datasources-user-b';

describe('DataSourcesRepository', () => {
  let repository: DataSourcesRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataSourcesRepository, PrismaService],
    }).compile();
    repository = module.get(DataSourcesRepository);
    prisma = module.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Clean up all test rows regardless of org
    await prisma.deviceMetric.deleteMany({
      where: { userId: { in: [USER_A, USER_B] } },
    });
  });

  describe('createMetric', () => {
    it('writes a DeviceMetric row with organizationId', async () => {
      await repository.createMetric({
        organizationId: ORG_A,
        userId: USER_A,
        sourceType: 'browser',
        bandwidthDown: 100,
        bandwidthUp: 20,
        latency: 15,
        connectionQuality: '4g',
      });
      const row = await prisma.deviceMetric.findFirst({
        where: { organizationId: ORG_A, userId: USER_A },
      });
      expect(row).not.toBeNull();
      expect(row!.bandwidthDown).toBe(100);
      expect(row!.organizationId).toBe(ORG_A);
    });
  });

  describe('findLatestForUser', () => {
    it('returns null when no metrics exist for the org+user pair', async () => {
      const result = await repository.findLatestForUser(ORG_A, USER_A);
      expect(result).toBeNull();
    });

    it('returns the most recent metric row scoped by organizationId + userId', async () => {
      await prisma.deviceMetric.create({
        data: {
          organizationId: ORG_A,
          userId: USER_A,
          sourceType: 'browser',
          bandwidthDown: 50,
          bandwidthUp: 10,
          latency: 30,
          connectionQuality: '3g',
        },
      });
      const result = await repository.findLatestForUser(ORG_A, USER_A);
      expect(result).not.toBeNull();
      expect(result!.bandwidthDown).toBe(50);
    });

    it('does not return rows from a different org (cross-org isolation)', async () => {
      // Insert a metric under ORG_B for USER_A
      await prisma.deviceMetric.create({
        data: {
          organizationId: ORG_B,
          userId: USER_A,
          sourceType: 'browser',
          bandwidthDown: 999,
          bandwidthUp: 999,
          latency: 999,
        },
      });
      // Query under ORG_A should return nothing
      const result = await repository.findLatestForUser(ORG_A, USER_A);
      expect(result).toBeNull();
    });
  });

  describe('findLatestForUsers (batch)', () => {
    it('returns empty array for empty userIds list', async () => {
      const result = await repository.findLatestForUsers(ORG_A, []);
      expect(result).toEqual([]);
    });

    it('returns one row per user with their latest metric, scoped by org', async () => {
      // Explicit timestamps - `createMany` evaluates `@default(now())` once per
      // statement, so the two records would otherwise share a timestamp and
      // ORDER BY time DESC would return either non-deterministically.
      // They are relative to now because the query only looks back over the live window
      // (LIVE_METRICS_MAX_AGE_HOURS): this feeds a LIVE push, so a reading from months ago is
      // deliberately not returned. See the staleness test at the bottom of this block.
      const earlier = new Date(Date.now() - 2000);
      const later = new Date(Date.now() - 1000);
      await prisma.deviceMetric.createMany({
        data: [
          { organizationId: ORG_A, userId: USER_A, sourceType: 'browser', latency: 10, time: earlier },
          { organizationId: ORG_A, userId: USER_A, sourceType: 'browser', latency: 20, time: later },
        ],
      });
      const results = await repository.findLatestForUsers(ORG_A, [USER_A]);
      expect(results).toHaveLength(1);
      // Most recent should have latency 20
      expect(results[0].latency).toBe(20);
    });

    it('cross-org isolation: org B metrics are invisible to an org A scoped read', async () => {
      // Insert metric for USER_B under ORG_B
      await prisma.deviceMetric.create({
        data: {
          organizationId: ORG_B,
          userId: USER_B,
          sourceType: 'browser',
          latency: 777,
          time: new Date(Date.now() - 1000),
        },
      });
      // Query org A for USER_B — must return nothing
      const results = await repository.findLatestForUsers(ORG_A, [USER_B]);
      expect(results).toHaveLength(0);
    });

    it('includes Phase-13 columns (deviceId, tag) in returned rows', async () => {
      // The raw SELECT lists columns explicitly; a column it omits comes back
      // undefined despite the DeviceMetric[] cast. Pin deviceId/tag here.
      await prisma.deviceMetric.create({
        data: {
          organizationId: ORG_A,
          userId: USER_A,
          sourceType: 'browser',
          deviceId: 'device-xyz',
          tag: 'speedtest',
          latency: 5,
          time: new Date(Date.now() - 1000),
        },
      });
      const results = await repository.findLatestForUsers(ORG_A, [USER_A]);
      expect(results).toHaveLength(1);
      expect(results[0].deviceId).toBe('device-xyz');
      expect(results[0].tag).toBe('speedtest');
    });

    /**
     * The query is bounded to a live window on purpose. Without a lower bound on `time` it had
     * to consider every chunk of a 30-day hypertable to find one row per user - once per org,
     * every REFRESH_INTERVAL_SECONDS. The bound is what lets TimescaleDB exclude the old chunks.
     * It is also honest: this feeds a LIVE metrics push, so a reading from last month is not a
     * live reading, and re-pushing it forever helps nobody.
     */
    it('ignores a reading older than the live window, so stale metrics are not re-pushed forever', async () => {
      await prisma.deviceMetric.create({
        data: {
          organizationId: ORG_A,
          userId: USER_A,
          sourceType: 'browser',
          latency: 99,
          time: new Date(Date.now() - 40 * 60 * 60 * 1000), // 40h old, past the 24h default
        },
      });
      expect(await repository.findLatestForUsers(ORG_A, [USER_A])).toHaveLength(0);
    });

    it('returns a reading inside the live window', async () => {
      await prisma.deviceMetric.create({
        data: {
          organizationId: ORG_A,
          userId: USER_A,
          sourceType: 'browser',
          latency: 42,
          time: new Date(Date.now() - 60 * 60 * 1000), // 1h old
        },
      });
      const results = await repository.findLatestForUsers(ORG_A, [USER_A]);
      expect(results).toHaveLength(1);
      expect(results[0].latency).toBe(42);
    });
  });
});
