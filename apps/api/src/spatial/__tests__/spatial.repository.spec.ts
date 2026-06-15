import { Test } from '@nestjs/testing';
import { DeviceCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SpatialRepository } from '../spatial.repository';

describe('SpatialRepository (integration)', () => {
  let repo: SpatialRepository;
  let prisma: PrismaService;
  let orgId: string;
  let userId: string;
  let networkId: string;
  let propertyId: string;

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

    const user = await prisma.user.create({
      data: { email: `sp-${Date.now()}@example.com`, emailVerified: false },
    });
    userId = user.id;

    const network = await prisma.network.create({
      data: { organizationId: orgId, userId, name: 'Test Network' },
    });
    networkId = network.id;

    const property = await prisma.property.create({
      data: { organizationId: orgId, name: 'HQ Site', type: 'SITE' },
    });
    propertyId = property.id;

    await prisma.networkProperty.create({
      data: { organizationId: orgId, networkId, propertyId },
    });
  });

  afterEach(async () => {
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
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

  describe('setPosition', () => {
    it('returns null when device does not exist (or belongs to a different org)', async () => {
      const result = await repo.setPosition(
        orgId,
        '00000000-0000-0000-0000-000000000000',
        1,
        2,
        3,
      );
      expect(result).toBeNull();
    });

    it('sets x/y/z coords and increments version on an existing device', async () => {
      const device = await prisma.device.create({
        data: {
          organizationId: orgId,
          userId,
          networkId,
          propertyId,
          name: `SPDevice-${Date.now()}`,
          category: DeviceCategory.ROUTER,
        },
      });
      expect(device.version).toBe(1);

      const updated = await repo.setPosition(orgId, device.id, 1.5, 2, 3);
      expect(updated).not.toBeNull();
      expect(updated!.x).toBe(1.5);
      expect(updated!.y).toBe(2);
      expect(updated!.z).toBe(3);
      expect(updated!.version).toBe(2);
    });
  });
});
