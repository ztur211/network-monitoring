import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { FiberRunsRepository } from '../fiber-runs.repository';
import { DeviceCategory } from '@prisma/client';

/**
 * Integration tests — requires test database running.
 */
describe('FiberRunsRepository (integration)', () => {
  let repository: FiberRunsRepository;
  let prisma: PrismaService;
  let testUserId: string;
  let deviceAId: string;
  let deviceBId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FiberRunsRepository, PrismaService],
    }).compile();

    repository = module.get<FiberRunsRepository>(FiberRunsRepository);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { email: `fiberrepo-${Date.now()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;

    const [devA, devB] = await Promise.all([
      prisma.device.create({ data: { userId: testUserId, name: 'Dev A', category: DeviceCategory.ROUTER } }),
      prisma.device.create({ data: { userId: testUserId, name: 'Dev B', category: DeviceCategory.SWITCH } }),
    ]);
    deviceAId = devA.id;
    deviceBId = devB.id;
  });

  afterEach(async () => {
    await prisma.fiberRun.deleteMany({ where: { userId: testUserId } });
    await prisma.device.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a fiber run and returns it', async () => {
      const run = await repository.create({
        userId: testUserId,
        name: 'Run 1',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      expect(run.id).toBeDefined();
      expect(run.name).toBe('Run 1');
      expect(run.version).toBe(1);
    });
  });

  describe('findAllByUserId', () => {
    it('returns all fiber runs for user', async () => {
      await repository.create({ userId: testUserId, name: 'Run A', startDeviceId: deviceAId, endDeviceId: deviceBId });
      const runs = await repository.findAllByUserId(testUserId);
      expect(runs).toHaveLength(1);
    });
  });

  describe('updateWithVersion', () => {
    it('updates and returns updated entity', async () => {
      const run = await repository.create({ userId: testUserId, name: 'Old', startDeviceId: deviceAId, endDeviceId: deviceBId });
      const updated = await repository.updateWithVersion(run.id, testUserId, { name: 'New' }, 1);
      expect(updated?.name).toBe('New');
      expect(updated?.version).toBe(2);
    });

    it('returns null on version mismatch', async () => {
      const run = await repository.create({ userId: testUserId, name: 'Old', startDeviceId: deviceAId, endDeviceId: deviceBId });
      const result = await repository.updateWithVersion(run.id, testUserId, { name: 'New' }, 99);
      expect(result).toBeNull();
    });
  });
});
