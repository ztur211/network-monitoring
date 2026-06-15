import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SpatialRepository } from '../spatial.repository';

describe('SpatialRepository (integration)', () => {
  let repo: SpatialRepository;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [SpatialRepository, PrismaService],
    }).compile();
    repo = ref.get(SpatialRepository);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `SP${Date.now()}${Math.round(performance.now())}` },
    });
    orgId = org.id;
  });

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('resolves the nearest BUILDING ancestor of a property; null when none', async () => {
    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' },
    });
    const bld = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'B' },
    });
    const flr = await prisma.property.create({
      data: { organizationId: orgId, parentId: bld.id, type: 'FLOOR', name: '1' },
    });

    expect(await repo.resolveGoverningBuildingId(orgId, flr.id)).toBe(bld.id);
    expect(await repo.resolveGoverningBuildingId(orgId, bld.id)).toBe(bld.id); // self
    expect(await repo.resolveGoverningBuildingId(orgId, site.id)).toBeNull(); // no building above a SITE
  });
});
