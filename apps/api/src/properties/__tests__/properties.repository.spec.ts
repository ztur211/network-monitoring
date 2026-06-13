import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertiesRepository } from '../properties.repository';

describe('PropertiesRepository (integration)', () => {
  let repo: PropertiesRepository;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PropertiesRepository, PrismaService],
    }).compile();
    repo = moduleRef.get(PropertiesRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `P${Date.now()}${Math.round(performance.now())}` } });
    orgId = org.id;
  });
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

  it('creates a root + child and lists children + subtree ids', async () => {
    const site = await repo.create({ organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ', code: 'hq' });
    const bld = await repo.create({ organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'A', code: 'a' });

    expect(await repo.findChildren(orgId, site.id)).toHaveLength(1);
    const ids = await repo.getSubtreeIds(orgId, site.id);
    expect(ids.sort()).toEqual([site.id, bld.id].sort());
    expect(await repo.isAtOrUnder(orgId, bld.id, site.id)).toBe(true);
    expect(await repo.isAtOrUnder(orgId, site.id, bld.id)).toBe(false);
  });

  it('detects a case-insensitive sibling-name collision (excluding self)', async () => {
    const site = await repo.create({ organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ', code: null });
    await repo.create({ organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Tower', code: null });
    expect(await repo.existsSiblingName(orgId, site.id, 'tower')).toBe(true);
    expect(await repo.existsSiblingName(orgId, site.id, 'Tower B')).toBe(false);
  });

  it('does not see a property from another org', async () => {
    const other = await prisma.organization.create({ data: { name: `O${Date.now()}` } });
    const p = await repo.create({ organizationId: other.id, parentId: null, type: 'SITE', name: 'X', code: null });
    expect(await repo.findByIdAndOrgId(p.id, orgId)).toBeNull();
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
