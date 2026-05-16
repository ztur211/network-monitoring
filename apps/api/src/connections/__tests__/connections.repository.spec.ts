import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectionsRepository } from '../connections.repository';
import { ConnectionType, DeviceCategory } from '@prisma/client';

/**
 * Integration tests — requires test database running.
 */
describe('ConnectionsRepository (integration)', () => {
  let repository: ConnectionsRepository;
  let prisma: PrismaService;
  let testUserId: string;
  let deviceAId: string;
  let deviceBId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConnectionsRepository, PrismaService],
    }).compile();

    repository = module.get<ConnectionsRepository>(ConnectionsRepository);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { email: `connrepo-${Date.now()}@example.com`, emailVerified: false },
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
    await prisma.deviceConnection.deleteMany({ where: { userId: testUserId } });
    await prisma.device.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a connection', async () => {
      const conn = await repository.create({
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      expect(conn.id).toBeDefined();
      expect(conn.version).toBe(1);
    });
  });

  describe('existsDuplicate', () => {
    it('returns true when duplicate connection exists', async () => {
      await repository.create({
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const exists = await repository.existsDuplicate(testUserId, deviceAId, deviceBId, ConnectionType.ETHERNET);
      expect(exists).toBe(true);
    });

    it('returns false for different connection type', async () => {
      const exists = await repository.existsDuplicate(testUserId, deviceAId, deviceBId, ConnectionType.FIBER);
      expect(exists).toBe(false);
    });
  });

  describe('updateWithVersion', () => {
    it('updates and increments version', async () => {
      const conn = await repository.create({
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const updated = await repository.updateWithVersion(conn.id, testUserId, { notes: 'note' }, 1);
      expect(updated?.notes).toBe('note');
      expect(updated?.version).toBe(2);
    });
  });
});
