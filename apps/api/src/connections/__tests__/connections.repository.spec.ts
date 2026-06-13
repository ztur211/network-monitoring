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
  let testOrgId: string;
  let testOrgBId: string;
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
      data: { email: `connrepo-${Date.now()}-${Math.random()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;

    const orgA = await prisma.organization.create({ data: { name: `ConnRepoOrgA-${Date.now()}` } });
    testOrgId = orgA.id;

    const orgB = await prisma.organization.create({ data: { name: `ConnRepoOrgB-${Date.now()}` } });
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
    await prisma.deviceConnection.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.device.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [testOrgId, testOrgBId] } } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a connection with organizationId and returns it with version=1', async () => {
      const conn = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      expect(conn.id).toBeDefined();
      expect(conn.organizationId).toBe(testOrgId);
      expect(conn.version).toBe(1);
    });

    it('creates a connection with null userId (system-created)', async () => {
      const conn = await repository.create({
        organizationId: testOrgId,
        userId: null,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.FIBER,
      });
      expect(conn.userId).toBeNull();
    });
  });

  describe('findAllByOrgId', () => {
    it('returns all connections for the org', async () => {
      await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const conns = await repository.findAllByOrgId(testOrgId);
      expect(conns).toHaveLength(1);
    });

    it('does not return connections from another org (cross-org isolation)', async () => {
      await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const conns = await repository.findAllByOrgId(testOrgBId);
      expect(conns).toHaveLength(0);
    });
  });

  describe('existsDuplicate', () => {
    it('returns true when duplicate connection exists in org', async () => {
      await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const exists = await repository.existsDuplicate(testOrgId, deviceAId, deviceBId, ConnectionType.ETHERNET);
      expect(exists).toBe(true);
    });

    it('returns false for different connection type', async () => {
      const exists = await repository.existsDuplicate(testOrgId, deviceAId, deviceBId, ConnectionType.FIBER);
      expect(exists).toBe(false);
    });

    it('returns false when same devices/type exist in a different org (cross-org isolation)', async () => {
      await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const exists = await repository.existsDuplicate(testOrgBId, deviceAId, deviceBId, ConnectionType.ETHERNET);
      expect(exists).toBe(false);
    });
  });

  describe('findByIdAndOrgId', () => {
    it('returns connection when found in org', async () => {
      const conn = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const found = await repository.findByIdAndOrgId(conn.id, testOrgId);
      expect(found?.id).toBe(conn.id);
    });

    it('returns null when connection belongs to a different org (cross-org isolation)', async () => {
      const conn = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const found = await repository.findByIdAndOrgId(conn.id, testOrgBId);
      expect(found).toBeNull();
    });
  });

  describe('updateWithVersion', () => {
    it('updates and increments version', async () => {
      const conn = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const updated = await repository.updateWithVersion(conn.id, testOrgId, { notes: 'note' }, 1);
      expect(updated?.notes).toBe('note');
      expect(updated?.version).toBe(2);
    });

    it('returns null when connection belongs to a different org (cross-org isolation)', async () => {
      const conn = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      const result = await repository.updateWithVersion(conn.id, testOrgBId, { notes: 'x' }, 1);
      expect(result).toBeNull();
    });
  });

  describe('deleteByIdAndOrgId', () => {
    it('deletes the connection', async () => {
      const conn = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      await repository.deleteByIdAndOrgId(conn.id, testOrgId);
      const found = await repository.findByIdAndOrgId(conn.id, testOrgId);
      expect(found).toBeNull();
    });

    it('does not delete connections belonging to another org (cross-org isolation)', async () => {
      const conn = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        sourceDeviceId: deviceAId,
        targetDeviceId: deviceBId,
        connectionType: ConnectionType.ETHERNET,
      });
      await repository.deleteByIdAndOrgId(conn.id, testOrgBId);
      const found = await repository.findByIdAndOrgId(conn.id, testOrgId);
      expect(found).not.toBeNull();
    });
  });
});
