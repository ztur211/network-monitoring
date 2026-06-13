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
  let testOrgId: string;
  let testOrgBId: string;

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

    const orgA = await prisma.organization.create({
      data: { name: `NetRepoOrgA-${Date.now()}` },
    });
    testOrgId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: `NetRepoOrgB-${Date.now()}` },
    });
    testOrgBId = orgB.id;
  });

  afterEach(async () => {
    await prisma.network.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [testOrgId, testOrgBId] } } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a network with name and returns it with version=1', async () => {
      const network = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Home' });
      expect(network.id).toBeDefined();
      expect(network.name).toBe('Home');
      expect(network.organizationId).toBe(testOrgId);
      expect(network.version).toBe(1);
      expect(network.homePublicIp).toBeNull();
    });

    it('persists all optional fields when provided', async () => {
      const network = await repository.create({
        organizationId: testOrgId,
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

    it('creates a network with null userId (system-created)', async () => {
      const network = await repository.create({ organizationId: testOrgId, userId: null, name: 'System Network' });
      expect(network.id).toBeDefined();
      expect(network.userId).toBeNull();
    });
  });

  describe('findAllByOrgId', () => {
    it('returns all networks for the org', async () => {
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'A' });
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'B' });
      const networks = await repository.findAllByOrgId(testOrgId);
      expect(networks).toHaveLength(2);
    });

    it('returns empty array for org with no networks', async () => {
      const networks = await repository.findAllByOrgId(testOrgId);
      expect(networks).toEqual([]);
    });

    it('does not return networks belonging to other orgs (cross-org isolation)', async () => {
      await repository.create({ organizationId: testOrgBId, userId: testUserId, name: "Other Org's Network" });
      const networks = await repository.findAllByOrgId(testOrgId);
      expect(networks).toHaveLength(0);
    });
  });

  describe('countByOrgId', () => {
    it('returns the count of networks for the org', async () => {
      expect(await repository.countByOrgId(testOrgId)).toBe(0);
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'A' });
      expect(await repository.countByOrgId(testOrgId)).toBe(1);
    });
  });

  describe('findByIdAndOrgId', () => {
    it('returns the network when it belongs to the org', async () => {
      const created = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'A' });
      const found = await repository.findByIdAndOrgId(created.id, testOrgId);
      expect(found?.id).toBe(created.id);
    });

    it('returns null when the network belongs to another org (cross-org isolation)', async () => {
      const created = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'OrgA Network' });
      const found = await repository.findByIdAndOrgId(created.id, testOrgBId);
      expect(found).toBeNull();
    });

    it('returns null when the id does not exist', async () => {
      const found = await repository.findByIdAndOrgId('00000000-0000-0000-0000-000000000000', testOrgId);
      expect(found).toBeNull();
    });
  });

  describe('findAllByMemberUserId', () => {
    it('returns networks from the org the user is a member of', async () => {
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Org A Net' });
      // Make testUserId a member of testOrgId
      await prisma.organizationMember.create({
        data: { userId: testUserId, organizationId: testOrgId, role: 'OWNER' },
      });

      const nets = await repository.findAllByMemberUserId(testUserId);
      expect(nets).toHaveLength(1);
      expect(nets[0].organizationId).toBe(testOrgId);

      await prisma.organizationMember.deleteMany({ where: { userId: testUserId } });
    });

    it('returns empty array when user is not a member of any org', async () => {
      await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'Org A Net' });
      const nets = await repository.findAllByMemberUserId(testUserId);
      expect(nets).toHaveLength(0);
    });
  });

  describe('updateWithVersion', () => {
    it('updates and increments version when expected version matches', async () => {
      const network = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'A' });
      const updated = await repository.updateWithVersion(network.id, testOrgId, { name: 'B' }, 1);
      expect(updated?.name).toBe('B');
      expect(updated?.version).toBe(2);
    });

    it('returns null when expected version mismatches', async () => {
      const network = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'A' });
      const updated = await repository.updateWithVersion(network.id, testOrgId, { name: 'B' }, 999);
      expect(updated).toBeNull();
    });

    it('returns null when the network belongs to another org (cross-org isolation)', async () => {
      const network = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'OrgA' });
      const updated = await repository.updateWithVersion(network.id, testOrgBId, { name: 'Y' }, 1);
      expect(updated).toBeNull();
    });
  });

  describe('deleteByIdAndOrgId', () => {
    it('deletes the network', async () => {
      const network = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'A' });
      await repository.deleteByIdAndOrgId(network.id, testOrgId);
      const found = await repository.findByIdAndOrgId(network.id, testOrgId);
      expect(found).toBeNull();
    });

    it('sets networkId to null on dependent devices (SetNull cascade)', async () => {
      const network = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'A' });
      const device = await prisma.device.create({
        data: {
          organizationId: testOrgId,
          userId: testUserId,
          networkId: network.id,
          name: `Router-${Date.now()}`,
          category: 'ROUTER',
        },
      });
      await repository.deleteByIdAndOrgId(network.id, testOrgId);
      const survivor = await prisma.device.findUnique({ where: { id: device.id } });
      expect(survivor?.networkId).toBeNull();
      await prisma.device.deleteMany({ where: { id: device.id } });
    });

    it('does not delete networks belonging to other orgs (cross-org isolation)', async () => {
      const network = await repository.create({ organizationId: testOrgId, userId: testUserId, name: 'OrgA Net' });
      await repository.deleteByIdAndOrgId(network.id, testOrgBId);
      const survivor = await prisma.network.findUnique({ where: { id: network.id } });
      expect(survivor).not.toBeNull();
    });
  });
});
