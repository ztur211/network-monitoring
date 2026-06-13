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
  let testOrgId: string;
  let testOrgBId: string;
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
      data: { email: `fiberrepo-${Date.now()}-${Math.random()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;

    const orgA = await prisma.organization.create({ data: { name: `FiberRepoOrgA-${Date.now()}` } });
    testOrgId = orgA.id;

    const orgB = await prisma.organization.create({ data: { name: `FiberRepoOrgB-${Date.now()}` } });
    testOrgBId = orgB.id;

    const [devA, devB] = await Promise.all([
      prisma.device.create({
        data: { organizationId: testOrgId, userId: testUserId, name: 'Dev A', category: DeviceCategory.ROUTER },
      }),
      prisma.device.create({
        data: { organizationId: testOrgId, userId: testUserId, name: 'Dev B', category: DeviceCategory.SWITCH },
      }),
    ]);
    deviceAId = devA.id;
    deviceBId = devB.id;
  });

  afterEach(async () => {
    await prisma.fiberRun.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.device.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [testOrgId, testOrgBId] } } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a fiber run with organizationId and returns it with version=1', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'Run 1',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      expect(run.id).toBeDefined();
      expect(run.organizationId).toBe(testOrgId);
      expect(run.name).toBe('Run 1');
      expect(run.version).toBe(1);
    });

    it('creates a fiber run with null userId (system-created)', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: null,
        name: 'System Run',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      expect(run.userId).toBeNull();
    });
  });

  describe('findAllByOrgId', () => {
    it('returns all fiber runs for org', async () => {
      await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'Run A',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      const runs = await repository.findAllByOrgId(testOrgId);
      expect(runs).toHaveLength(1);
    });

    it('does not return fiber runs from another org (cross-org isolation)', async () => {
      await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'OrgA Run',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      const runs = await repository.findAllByOrgId(testOrgBId);
      expect(runs).toHaveLength(0);
    });
  });

  describe('findByIdAndOrgId', () => {
    it('returns fiber run when found in org', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'Run',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      const found = await repository.findByIdAndOrgId(run.id, testOrgId);
      expect(found?.id).toBe(run.id);
    });

    it('returns null when fiber run belongs to a different org (cross-org isolation)', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'OrgA Run',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      const found = await repository.findByIdAndOrgId(run.id, testOrgBId);
      expect(found).toBeNull();
    });
  });

  describe('updateWithVersion', () => {
    it('updates and returns updated entity', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'Old',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      const updated = await repository.updateWithVersion(run.id, testOrgId, { name: 'New' }, 1);
      expect(updated?.name).toBe('New');
      expect(updated?.version).toBe(2);
    });

    it('returns null on version mismatch', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'Old',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      const result = await repository.updateWithVersion(run.id, testOrgId, { name: 'New' }, 99);
      expect(result).toBeNull();
    });

    it('returns null when fiber run belongs to a different org (cross-org isolation)', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'OrgA Run',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      const result = await repository.updateWithVersion(run.id, testOrgBId, { name: 'New' }, 1);
      expect(result).toBeNull();
    });
  });

  describe('deleteByIdAndOrgId', () => {
    it('deletes the fiber run', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'Run',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      await repository.deleteByIdAndOrgId(run.id, testOrgId);
      const found = await repository.findByIdAndOrgId(run.id, testOrgId);
      expect(found).toBeNull();
    });

    it('does not delete fiber runs belonging to another org (cross-org isolation)', async () => {
      const run = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'OrgA Run',
        startDeviceId: deviceAId,
        endDeviceId: deviceBId,
      });
      await repository.deleteByIdAndOrgId(run.id, testOrgBId);
      const found = await repository.findByIdAndOrgId(run.id, testOrgId);
      expect(found).not.toBeNull();
    });
  });
});
