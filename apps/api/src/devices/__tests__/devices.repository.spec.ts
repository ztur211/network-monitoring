import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { DevicesRepository } from '../devices.repository';
import { DeviceCategory } from '@prisma/client';

/**
 * Integration tests — run against the real test database.
 * Requires docker compose -f docker-compose.test.yml up to be running.
 * TEST_DATABASE_URL must be set in the environment.
 */
describe('DevicesRepository (integration)', () => {
  let repository: DevicesRepository;
  let prisma: PrismaService;
  let testUserId: string;
  let testOrgId: string;
  let testOrgBId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DevicesRepository, PrismaService],
    }).compile();

    repository = module.get<DevicesRepository>(DevicesRepository);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { email: `devrepo-${Date.now()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;

    const orgA = await prisma.organization.create({
      data: { name: `DevRepoOrgA-${Date.now()}` },
    });
    testOrgId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: `DevRepoOrgB-${Date.now()}` },
    });
    testOrgBId = orgB.id;
  });

  afterEach(async () => {
    await prisma.device.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.device.deleteMany({ where: { organizationId: testOrgBId } });
    await prisma.organization.deleteMany({ where: { id: { in: [testOrgId, testOrgBId] } } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a device and returns it', async () => {
      const device = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        name: 'Test Router',
        category: DeviceCategory.ROUTER,
      });
      expect(device.id).toBeDefined();
      expect(device.name).toBe('Test Router');
      expect(device.organizationId).toBe(testOrgId);
      expect(device.userId).toBe(testUserId);
      expect(device.version).toBe(1);
    });

    it('creates a device with null userId (system-created)', async () => {
      const device = await repository.create({
        organizationId: testOrgId,
        userId: null,
        name: 'System Device',
        category: DeviceCategory.ROUTER,
      });
      expect(device.id).toBeDefined();
      expect(device.userId).toBeNull();
    });
  });

  describe('findAllByOrgId', () => {
    it('returns devices for org ordered by createdAt desc', async () => {
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Device A', category: DeviceCategory.SWITCH });
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Device B', category: DeviceCategory.ROUTER });

      const devices = await repository.findAllByOrgId(testOrgId);
      expect(devices).toHaveLength(2);
    });

    it('does not return devices from another org', async () => {
      await repository.create({ organizationId: testOrgBId, userId: testUserId, name: 'Other Org Device', category: DeviceCategory.ROUTER });
      const devices = await repository.findAllByOrgId(testOrgId);
      expect(devices).toHaveLength(0);
    });
  });

  describe('countByOrgId', () => {
    it('returns correct device count for org', async () => {
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Device 1', category: DeviceCategory.SWITCH });
      const count = await repository.countByOrgId(testOrgId);
      expect(count).toBe(1);
    });
  });

  describe('findByIdAndOrgId', () => {
    it('returns device when found in org', async () => {
      const created = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Findable', category: DeviceCategory.ROUTER });
      const found = await repository.findByIdAndOrgId(created.id, testOrgId);
      expect(found?.id).toBe(created.id);
    });

    it('returns null when device belongs to a different org (cross-org isolation)', async () => {
      const created = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'OrgA Device', category: DeviceCategory.ROUTER });
      const found = await repository.findByIdAndOrgId(created.id, testOrgBId);
      expect(found).toBeNull();
    });

    it('returns null for a completely non-existent device id', async () => {
      const found = await repository.findByIdAndOrgId('00000000-0000-0000-0000-000000000000', testOrgId);
      expect(found).toBeNull();
    });
  });

  describe('updateWithVersion', () => {
    it('updates device when version matches and returns updated device', async () => {
      const device = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Old Name', category: DeviceCategory.ROUTER });
      const updated = await repository.updateWithVersion(device.id, testOrgId, { name: 'New Name' }, 1);
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.version).toBe(2);
    });

    it('returns null when version does not match (concurrent edit)', async () => {
      const device = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Device', category: DeviceCategory.ROUTER });
      const result = await repository.updateWithVersion(device.id, testOrgId, { notes: 'note' }, 99);
      expect(result).toBeNull();
    });

    it('returns null when deviceId belongs to a different org', async () => {
      const device = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'OrgA Only', category: DeviceCategory.ROUTER });
      const result = await repository.updateWithVersion(device.id, testOrgBId, { notes: 'note' }, 1);
      expect(result).toBeNull();
    });
  });

  describe('existsByNameCaseInsensitive', () => {
    it('returns true when name matches (case-insensitive) in same org', async () => {
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Router One', category: DeviceCategory.ROUTER });
      const exists = await repository.existsByNameCaseInsensitive(testOrgId, 'router one');
      expect(exists).toBe(true);
    });

    it('returns false when excluding own device id', async () => {
      const device = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Router One', category: DeviceCategory.ROUTER });
      const exists = await repository.existsByNameCaseInsensitive(testOrgId, 'router one', device.id);
      expect(exists).toBe(false);
    });

    it('returns false when same name exists in a different org', async () => {
      await repository.create({ organizationId: testOrgBId, userId: testUserId, name: 'Shared Name', category: DeviceCategory.ROUTER });
      const exists = await repository.existsByNameCaseInsensitive(testOrgId, 'Shared Name');
      expect(exists).toBe(false);
    });
  });

  describe('deleteByIdAndOrgId', () => {
    it('deletes device', async () => {
      const device = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Delete Me', category: DeviceCategory.ROUTER });
      await repository.deleteByIdAndOrgId(device.id, testOrgId);
      const found = await repository.findByIdAndOrgId(device.id, testOrgId);
      expect(found).toBeNull();
    });

    it('does not delete device belonging to a different org', async () => {
      const device = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Stay', category: DeviceCategory.ROUTER });
      await repository.deleteByIdAndOrgId(device.id, testOrgBId);
      const found = await repository.findByIdAndOrgId(device.id, testOrgId);
      expect(found).not.toBeNull();
    });
  });
});
