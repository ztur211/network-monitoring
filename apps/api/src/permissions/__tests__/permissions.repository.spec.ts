import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyTreeRepository } from '../../property-tree/property-tree.repository';
import {
  breakCycles,
  createCycle,
  expectPropertyTreeCycle,
} from '../../property-tree/__tests__/tree-cycle.helpers';
import { PermissionsRepository } from '../permissions.repository';

describe('PermissionsRepository (integration)', () => {
  let repo: PermissionsRepository;
  let prisma: PrismaService;
  let orgId: string;
  let ownerId: string; // OrganizationMember.id
  let memberId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PermissionsRepository, PrismaService, PropertyTreeRepository],
    }).compile();
    repo = moduleRef.get(PermissionsRepository);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `T${Date.now()}${Math.round(performance.now())}` } });
    orgId = org.id;
    const ownerUser = await prisma.user.create({ data: { email: `o-${org.id}@x.io`, emailVerified: false } });
    const memberUser = await prisma.user.create({ data: { email: `m-${org.id}@x.io`, emailVerified: false } });
    const owner = await prisma.organizationMember.create({ data: { organizationId: orgId, userId: ownerUser.id, role: 'OWNER' } });
    const member = await prisma.organizationMember.create({ data: { organizationId: orgId, userId: memberUser.id, role: 'MEMBER' } });
    ownerId = owner.id; memberId = member.id;
  });
  afterEach(async () => {
    // parentId is ON DELETE RESTRICT: a cycle would block teardown and leak into the test DB.
    await breakCycles(prisma, orgId);
    await prisma.organization.delete({ where: { id: orgId } });
  });

  async function makeSite(name: string) {
    return prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name } });
  }

  it('effectiveRootPropertyIds unions team assignments and direct grants (deduped)', async () => {
    const a = await makeSite('A');
    const b = await makeSite('B');
    const c = await makeSite('C');
    const team = await repo.createTeam({ organizationId: orgId, name: 'NE', creatorMemberId: ownerId });
    await repo.addTeamProperty({ organizationId: orgId, teamId: team.id, propertyId: a.id });
    await repo.addTeamProperty({ organizationId: orgId, teamId: team.id, propertyId: b.id });
    await repo.addTeamMember({ organizationId: orgId, teamId: team.id, memberId });
    await repo.addMemberProperty({ organizationId: orgId, memberId, propertyId: b.id }); // dup of team's B
    await repo.addMemberProperty({ organizationId: orgId, memberId, propertyId: c.id });

    const roots = await repo.effectiveRootPropertyIds(orgId, memberId);
    expect(roots.sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('a member with no team/direct grants has no roots', async () => {
    expect(await repo.effectiveRootPropertyIds(orgId, memberId)).toEqual([]);
  });

  it('enforces case-insensitive org-unique team name', async () => {
    await repo.createTeam({ organizationId: orgId, name: 'Ops', creatorMemberId: ownerId });
    await expect(repo.createTeam({ organizationId: orgId, name: 'ops', creatorMemberId: ownerId }))
      .rejects.toThrow(); // Prisma P2002 from team_org_name_lower_uniq
  });

  it('ancestorPropertyIds returns the node and every ancestor', async () => {
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ' } });
    const bld = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'A' } });
    const flr = await prisma.property.create({ data: { organizationId: orgId, parentId: bld.id, type: 'FLOOR', name: '1' } });
    const ids = await repo.ancestorPropertyIds(orgId, flr.id);
    expect(ids.sort()).toEqual([site.id, bld.id, flr.id].sort());
  });

  // subtreePropertyIds backs PermissionsService.scopePropertyIds -> scopeFilter, which runs on the
  // authorization path of nearly every request. A cycle in the stored tree used to make it spin
  // forever inside Postgres, pinning one connection per request until the pool was exhausted and the
  // whole API stopped serving. It must now terminate and refuse.
  describe('with a cycle in the stored property tree', () => {
    it('subtreePropertyIds terminates and refuses instead of hanging the authorization path', async () => {
      const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'HQ' } });
      const bld = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'A' } });
      const flr = await prisma.property.create({ data: { organizationId: orgId, parentId: bld.id, type: 'FLOOR', name: '1' } });
      await createCycle(prisma, site.id, flr.id); // HQ's parent becomes the floor beneath it

      await expectPropertyTreeCycle(() => repo.subtreePropertyIds(orgId, flr.id));
      await expectPropertyTreeCycle(() => repo.ancestorPropertyIds(orgId, flr.id));
    });
  });
});
