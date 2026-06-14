import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsRepository } from '../permissions.repository';

describe('PermissionsRepository (integration)', () => {
  let repo: PermissionsRepository;
  let prisma: PrismaService;
  let orgId: string;
  let ownerId: string; // OrganizationMember.id
  let memberId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PermissionsRepository, PrismaService],
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
  afterEach(async () => { await prisma.organization.delete({ where: { id: orgId } }); });

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
});
