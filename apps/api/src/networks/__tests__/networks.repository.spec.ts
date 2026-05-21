import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NetworksRepository } from '../networks.repository';

/**
 * Integration tests — requires test database running.
 */
describe('NetworksRepository (integration)', () => {
  let repository: NetworksRepository;
  let prisma: PrismaService;
  let testUserId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NetworksRepository, PrismaService],
    }).compile();

    repository = module.get<NetworksRepository>(NetworksRepository);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { email: `netrepo-${Date.now()}-${Math.random()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a network with name and returns it with version=1', async () => {
      const network = await repository.create({ userId: testUserId, name: 'Home' });
      expect(network.id).toBeDefined();
      expect(network.name).toBe('Home');
      expect(network.version).toBe(1);
      expect(network.homePublicIp).toBeNull();
    });

    it('persists all optional fields when provided', async () => {
      const network = await repository.create({
        userId: testUserId,
        name: 'Home',
        homeAddress: '1 Main St',
        homeLatitude: 40.0,
        homeLongitude: -74.0,
        homePublicIp: '203.0.113.1',
        isp: 'Comcast',
        downMbps: 940,
        upMbps: 35,
      });
      expect(network.homeAddress).toBe('1 Main St');
      expect(network.homePublicIp).toBe('203.0.113.1');
      expect(network.isp).toBe('Comcast');
      expect(network.downMbps).toBe(940);
    });
  });

  describe('findAllByUserId', () => {
    it('returns all networks for the user', async () => {
      await repository.create({ userId: testUserId, name: 'A' });
      await repository.create({ userId: testUserId, name: 'B' });
      const networks = await repository.findAllByUserId(testUserId);
      expect(networks).toHaveLength(2);
    });

    it('returns empty array for user with no networks', async () => {
      const networks = await repository.findAllByUserId(testUserId);
      expect(networks).toEqual([]);
    });

    it('does not return networks belonging to other users', async () => {
      const otherUser = await prisma.user.create({
        data: { email: `other-${Date.now()}-${Math.random()}@example.com`, emailVerified: false },
      });
      await repository.create({ userId: otherUser.id, name: "Other's Network" });
      const networks = await repository.findAllByUserId(testUserId);
      expect(networks).toEqual([]);
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    });
  });

  describe('countByUserId', () => {
    it('returns the count of networks for the user', async () => {
      expect(await repository.countByUserId(testUserId)).toBe(0);
      await repository.create({ userId: testUserId, name: 'A' });
      expect(await repository.countByUserId(testUserId)).toBe(1);
    });
  });

  describe('findByIdAndUserId', () => {
    it('returns the network when it belongs to the user', async () => {
      const created = await repository.create({ userId: testUserId, name: 'A' });
      const found = await repository.findByIdAndUserId(created.id, testUserId);
      expect(found?.id).toBe(created.id);
    });

    it('returns null when the network belongs to another user', async () => {
      const otherUser = await prisma.user.create({
        data: { email: `other-${Date.now()}-${Math.random()}@example.com`, emailVerified: false },
      });
      const other = await repository.create({ userId: otherUser.id, name: 'X' });
      const found = await repository.findByIdAndUserId(other.id, testUserId);
      expect(found).toBeNull();
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    });

    it('returns null when the id does not exist', async () => {
      const found = await repository.findByIdAndUserId('00000000-0000-0000-0000-000000000000', testUserId);
      expect(found).toBeNull();
    });
  });

  describe('updateWithVersion', () => {
    it('updates and increments version when expected version matches', async () => {
      const network = await repository.create({ userId: testUserId, name: 'A' });
      const updated = await repository.updateWithVersion(
        network.id,
        testUserId,
        { name: 'B' },
        1,
      );
      expect(updated?.name).toBe('B');
      expect(updated?.version).toBe(2);
    });

    it('returns null when expected version mismatches', async () => {
      const network = await repository.create({ userId: testUserId, name: 'A' });
      const updated = await repository.updateWithVersion(
        network.id,
        testUserId,
        { name: 'B' },
        999,
      );
      expect(updated).toBeNull();
    });

    it('returns null when the network belongs to another user', async () => {
      const otherUser = await prisma.user.create({
        data: { email: `other-${Date.now()}-${Math.random()}@example.com`, emailVerified: false },
      });
      const other = await repository.create({ userId: otherUser.id, name: 'X' });
      const updated = await repository.updateWithVersion(other.id, testUserId, { name: 'Y' }, 1);
      expect(updated).toBeNull();
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    });
  });

  describe('deleteByIdAndUserId', () => {
    it('deletes the network', async () => {
      const network = await repository.create({ userId: testUserId, name: 'A' });
      await repository.deleteByIdAndUserId(network.id, testUserId);
      const found = await repository.findByIdAndUserId(network.id, testUserId);
      expect(found).toBeNull();
    });

    it('sets networkId to null on dependent devices (SetNull cascade)', async () => {
      const network = await repository.create({ userId: testUserId, name: 'A' });
      const device = await prisma.device.create({
        data: {
          userId: testUserId,
          networkId: network.id,
          name: `Router-${Date.now()}`,
          category: 'ROUTER',
        },
      });
      await repository.deleteByIdAndUserId(network.id, testUserId);
      const survivor = await prisma.device.findUnique({ where: { id: device.id } });
      expect(survivor?.networkId).toBeNull();
    });

    it('does not delete networks belonging to other users', async () => {
      const otherUser = await prisma.user.create({
        data: { email: `other-${Date.now()}-${Math.random()}@example.com`, emailVerified: false },
      });
      const other = await repository.create({ userId: otherUser.id, name: 'X' });
      await repository.deleteByIdAndUserId(other.id, testUserId);
      const survivor = await prisma.network.findUnique({ where: { id: other.id } });
      expect(survivor).not.toBeNull();
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    });
  });
});
