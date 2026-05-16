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
      data: { email: `circrepo-${Date.now()}@example.com`, emailVerified: false },
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await prisma.circuit.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  describe('create', () => {
    it('creates a circuit and returns it', async () => {
      const circuit = await repository.create({
        userId: testUserId,
        ispName: 'Comcast',
        serviceType: 'Fiber',
      });
      expect(circuit.id).toBeDefined();
      expect(circuit.ispName).toBe('Comcast');
      expect(circuit.version).toBe(1);
    });
  });

  describe('findWithCursor', () => {
    it('returns circuits up to limit', async () => {
      await repository.create({ userId: testUserId, ispName: 'ISP A', serviceType: 'Fiber' });
      await repository.create({ userId: testUserId, ispName: 'ISP B', serviceType: 'Cable' });

      const results = await repository.findWithCursor(testUserId, 10, undefined);
      expect(results).toHaveLength(2);
    });

    it('respects cursor for pagination', async () => {
      const c1 = await repository.create({ userId: testUserId, ispName: 'ISP A', serviceType: 'Fiber' });
      await repository.create({ userId: testUserId, ispName: 'ISP B', serviceType: 'Cable' });

      const cursor = Buffer.from(JSON.stringify({ createdAt: c1.createdAt.toISOString(), id: c1.id })).toString('base64');
      const page2 = await repository.findWithCursor(testUserId, 10, cursor);
      expect(page2.every((c) => c.id !== c1.id)).toBe(true);
    });
  });

  describe('updateWithVersion', () => {
    it('updates and increments version', async () => {
      const circuit = await repository.create({ userId: testUserId, ispName: 'Old ISP', serviceType: 'Fiber' });
      const updated = await repository.updateWithVersion(circuit.id, testUserId, { ispName: 'New ISP' }, 1);
      expect(updated?.ispName).toBe('New ISP');
      expect(updated?.version).toBe(2);
    });
  });
});
