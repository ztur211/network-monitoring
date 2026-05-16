import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { DataSourcesRepository } from '../data-sources.repository';

// Integration tests — run against real test DB
// Run with: npm run test:integration --workspace=apps/api

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
    await prisma.deviceMetric.deleteMany({ where: { userId: 'test-datasources-user' } });
  });

  describe('createMetric', () => {
    it('writes a DeviceMetric row', async () => {
      await repository.createMetric({
        userId: 'test-datasources-user',
        sourceType: 'browser',
        bandwidthDown: 100,
        bandwidthUp: 20,
        latency: 15,
        connectionQuality: '4g',
      });
      const row = await prisma.deviceMetric.findFirst({
        where: { userId: 'test-datasources-user' },
      });
      expect(row).not.toBeNull();
      expect(row!.bandwidthDown).toBe(100);
    });
  });

  describe('findLatestForUser', () => {
    it('returns null when no metrics exist', async () => {
      const result = await repository.findLatestForUser('test-datasources-user');
      expect(result).toBeNull();
    });

    it('returns the most recent metric row', async () => {
      await prisma.deviceMetric.create({
        data: {
          userId: 'test-datasources-user',
          sourceType: 'browser',
          bandwidthDown: 50,
          bandwidthUp: 10,
          latency: 30,
          connectionQuality: '3g',
        },
      });
      const result = await repository.findLatestForUser('test-datasources-user');
      expect(result).not.toBeNull();
      expect(result!.bandwidthDown).toBe(50);
    });
  });

  describe('findLatestForUsers (batch)', () => {
    it('returns empty array for empty userIds list', async () => {
      const result = await repository.findLatestForUsers([]);
      expect(result).toEqual([]);
    });

    it('returns one row per user with their latest metric', async () => {
      await prisma.deviceMetric.createMany({
        data: [
          { userId: 'test-datasources-user', sourceType: 'browser', latency: 10 },
          { userId: 'test-datasources-user', sourceType: 'browser', latency: 20 },
        ],
      });
      const results = await repository.findLatestForUsers(['test-datasources-user']);
      expect(results).toHaveLength(1);
      // Most recent should have latency 20
      expect(results[0].latency).toBe(20);
    });
  });
});
