import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CircuitsRepository } from '../circuits.repository';

/**
 * Integration tests — requires test database running.
 */
describe('CircuitsRepository (integration)', () => {
  let repository: CircuitsRepository;
  let prisma: PrismaService;
  let testUserId: string;
  let testOrgId: string;
  let testOrgBId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitsRepository, PrismaService],
    }).compile();

    repository = module.get<CircuitsRepository>(CircuitsRepository);
    prisma = module.get<PrismaService>(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { email: `circrepo-${Date.now()}-${Math.random()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;

    const orgA = await prisma.organization.create({ data: { name: `CircRepoOrgA-${Date.now()}` } });
    testOrgId = orgA.id;

    const orgB = await prisma.organization.create({ data: { name: `CircRepoOrgB-${Date.now()}` } });
    testOrgBId = orgB.id;
  });

  afterEach(async () => {
    await prisma.circuit.deleteMany({ where: { organizationId: { in: [testOrgId, testOrgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [testOrgId, testOrgBId] } } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a circuit with organizationId and returns it with version=1', async () => {
      const circuit = await repository.create({
        organizationId: testOrgId,
        userId: testUserId,
        ispName: 'Comcast',
        serviceType: 'Fiber',
      });
      expect(circuit.id).toBeDefined();
      expect(circuit.organizationId).toBe(testOrgId);
      expect(circuit.ispName).toBe('Comcast');
      expect(circuit.version).toBe(1);
    });

    it('creates a circuit with null userId (system-created)', async () => {
      const circuit = await repository.create({
        organizationId: testOrgId,
        userId: null,
        ispName: 'ISP',
        serviceType: 'Fiber',
      });
      expect(circuit.userId).toBeNull();
    });
  });

  describe('findWithCursor', () => {
    it('returns circuits up to limit scoped to org', async () => {
      await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'ISP A', serviceType: 'Fiber' });
      await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'ISP B', serviceType: 'Cable' });

      const results = await repository.findWithCursor(testOrgId, 10, undefined);
      expect(results).toHaveLength(2);
    });

    it('does not return circuits from another org (cross-org isolation)', async () => {
      await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'OrgA ISP', serviceType: 'Fiber' });
      const results = await repository.findWithCursor(testOrgBId, 10, undefined);
      expect(results).toHaveLength(0);
    });

    it('respects cursor for pagination', async () => {
      const c1 = await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'ISP A', serviceType: 'Fiber' });
      await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'ISP B', serviceType: 'Cable' });

      const cursor = Buffer.from(JSON.stringify({ createdAt: c1.createdAt.toISOString(), id: c1.id })).toString('base64');
      const page2 = await repository.findWithCursor(testOrgId, 10, cursor);
      expect(page2.every((c) => c.id !== c1.id)).toBe(true);
    });
  });

  describe('countByOrgId', () => {
    it('returns count scoped to org', async () => {
      expect(await repository.countByOrgId(testOrgId)).toBe(0);
      await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'ISP', serviceType: 'Fiber' });
      expect(await repository.countByOrgId(testOrgId)).toBe(1);
      expect(await repository.countByOrgId(testOrgBId)).toBe(0);
    });
  });

  describe('findByIdAndOrgId', () => {
    it('returns circuit when found in org', async () => {
      const circuit = await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'ISP', serviceType: 'Fiber' });
      const found = await repository.findByIdAndOrgId(circuit.id, testOrgId);
      expect(found?.id).toBe(circuit.id);
    });

    it('returns null when circuit belongs to a different org (cross-org isolation)', async () => {
      const circuit = await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'OrgA ISP', serviceType: 'Fiber' });
      const found = await repository.findByIdAndOrgId(circuit.id, testOrgBId);
      expect(found).toBeNull();
    });
  });

  describe('updateWithVersion', () => {
    it('updates and increments version', async () => {
      const circuit = await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'Old ISP', serviceType: 'Fiber' });
      const updated = await repository.updateWithVersion(circuit.id, testOrgId, { ispName: 'New ISP' }, 1);
      expect(updated?.ispName).toBe('New ISP');
      expect(updated?.version).toBe(2);
    });

    it('returns null when circuit belongs to a different org (cross-org isolation)', async () => {
      const circuit = await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'ISP', serviceType: 'Fiber' });
      const result = await repository.updateWithVersion(circuit.id, testOrgBId, { ispName: 'X' }, 1);
      expect(result).toBeNull();
    });
  });

  describe('deleteByIdAndOrgId', () => {
    it('deletes the circuit', async () => {
      const circuit = await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'ISP', serviceType: 'Fiber' });
      await repository.deleteByIdAndOrgId(circuit.id, testOrgId);
      const found = await repository.findByIdAndOrgId(circuit.id, testOrgId);
      expect(found).toBeNull();
    });

    it('does not delete circuits belonging to another org (cross-org isolation)', async () => {
      const circuit = await repository.create({ organizationId: testOrgId, userId: testUserId, ispName: 'OrgA ISP', serviceType: 'Fiber' });
      await repository.deleteByIdAndOrgId(circuit.id, testOrgBId);
      const found = await repository.findByIdAndOrgId(circuit.id, testOrgId);
      expect(found).not.toBeNull();
    });
  });
});
