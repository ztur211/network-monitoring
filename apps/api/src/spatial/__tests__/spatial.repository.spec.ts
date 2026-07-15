import { Test } from '@nestjs/testing';
import { DeviceCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyTreeRepository } from '../../property-tree/property-tree.repository';
import {
  breakCycles,
  createCycle,
  expectPropertyTreeCycle,
} from '../../property-tree/__tests__/tree-cycle.helpers';
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
      providers: [SpatialRepository, PrismaService, PropertyTreeRepository],
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
    // parentId is ON DELETE RESTRICT: a cycle would block the deleteMany below and leak into the test DB.
    await breakCycles(prisma, orgId);
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

  it('picks the NEAREST building when two are stacked up the chain', async () => {
    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S2' },
    });
    const outer = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Outer' },
    });
    const flr = await prisma.property.create({
      data: { organizationId: orgId, parentId: outer.id, type: 'FLOOR', name: 'F' },
    });
    const area = await prisma.property.create({
      data: { organizationId: orgId, parentId: flr.id, type: 'AREA', name: 'A' },
    });

    expect(await repo.resolveGoverningBuildingId(orgId, area.id)).toBe(outer.id);
  });

  // The upward walk used to be an unbounded UNION ALL that spun forever inside Postgres on a cyclic
  // tree; the `depth` column it carried was only used for ordering, never as a bound.
  it('terminates and refuses when the property tree contains a cycle', async () => {
    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'SC' },
    });
    const bld = await prisma.property.create({
      data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'BC' },
    });
    const flr = await prisma.property.create({
      data: { organizationId: orgId, parentId: bld.id, type: 'FLOOR', name: '1C' },
    });
    await createCycle(prisma, site.id, flr.id); // the SITE's parent becomes the floor beneath it

    await expectPropertyTreeCycle(() => repo.resolveGoverningBuildingId(orgId, flr.id));
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
