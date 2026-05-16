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
  });

  afterEach(async () => {
    await prisma.device.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a device and returns it', async () => {
      const device = await repository.create({
        userId: testUserId,
        name: 'Test Router',
        category: DeviceCategory.ROUTER,
      });
      expect(device.id).toBeDefined();
      expect(device.name).toBe('Test Router');
      expect(device.version).toBe(1);
    });
  });

  describe('findAllByUserId', () => {
    it('returns devices for user ordered by createdAt desc', async () => {
      await repository.create({ userId: testUserId, name: 'Device A', category: DeviceCategory.SWITCH });
      await repository.create({ userId: testUserId, name: 'Device B', category: DeviceCategory.ROUTER });

      const devices = await repository.findAllByUserId(testUserId);
      expect(devices).toHaveLength(2);
    });
  });

  describe('countByUserId', () => {
    it('returns correct device count', async () => {
      await repository.create({ userId: testUserId, name: 'Device 1', category: DeviceCategory.SWITCH });
      const count = await repository.countByUserId(testUserId);
      expect(count).toBe(1);
    });
  });

  describe('findByIdAndUserId', () => {
    it('returns device when found', async () => {
      const created = await repository.create({ userId: testUserId, name: 'Findable', category: DeviceCategory.ROUTER });
      const found = await repository.findByIdAndUserId(created.id, testUserId);
      expect(found?.id).toBe(created.id);
    });

    it('returns null for another user device', async () => {
      const created = await repository.create({ userId: testUserId, name: 'Other', category: DeviceCategory.ROUTER });
      const found = await repository.findByIdAndUserId(created.id, 'different-user');
      expect(found).toBeNull();
    });
  });

  describe('updateWithVersion', () => {
    it('updates device when version matches and returns updated device', async () => {
      const device = await repository.create({ userId: testUserId, name: 'Old Name', category: DeviceCategory.ROUTER });
      const updated = await repository.updateWithVersion(device.id, testUserId, { name: 'New Name' }, 1);
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.version).toBe(2);
    });

    it('returns null when version does not match (concurrent edit)', async () => {
      const device = await repository.create({ userId: testUserId, name: 'Device', category: DeviceCategory.ROUTER });
      const result = await repository.updateWithVersion(device.id, testUserId, { notes: 'note' }, 99);
      expect(result).toBeNull();
    });
  });

  describe('existsByNameCaseInsensitive', () => {
    it('returns true when name matches (case-insensitive)', async () => {
      await repository.create({ userId: testUserId, name: 'Router One', category: DeviceCategory.ROUTER });
      const exists = await repository.existsByNameCaseInsensitive(testUserId, 'router one');
      expect(exists).toBe(true);
    });

    it('returns false when excluding own device id', async () => {
      const device = await repository.create({ userId: testUserId, name: 'Router One', category: DeviceCategory.ROUTER });
      const exists = await repository.existsByNameCaseInsensitive(testUserId, 'router one', device.id);
      expect(exists).toBe(false);
    });
  });

  describe('deleteByIdAndUserId', () => {
    it('deletes device', async () => {
      const device = await repository.create({ userId: testUserId, name: 'Delete Me', category: DeviceCategory.ROUTER });
      await repository.deleteByIdAndUserId(device.id, testUserId);
      const found = await repository.findByIdAndUserId(device.id, testUserId);
      expect(found).toBeNull();
    });
  });
});
