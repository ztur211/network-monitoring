import { Injectable } from '@nestjs/common';
import { Team, TeamMember, TeamProperty, MemberProperty, OrganizationMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMember(organizationId: string, userId: string): Promise<OrganizationMember | null> {
    return this.prisma.organizationMember.findFirst({ where: { organizationId, userId } });
  }

  createTeam(data: { organizationId: string; name: string; creatorMemberId: string | null }): Promise<Team> {
    return this.prisma.team.create({ data });
  }

  addTeamMember(data: { organizationId: string; teamId: string; memberId: string }): Promise<TeamMember> {
    return this.prisma.teamMember.create({ data });
  }

  addTeamProperty(data: { organizationId: string; teamId: string; propertyId: string }): Promise<TeamProperty> {
    return this.prisma.teamProperty.create({ data });
  }

  addMemberProperty(data: { organizationId: string; memberId: string; propertyId: string }): Promise<MemberProperty> {
    return this.prisma.memberProperty.create({ data });
  }

  /** Union of (team assignments via membership) and (direct member assignments). Deduped. */
  async effectiveRootPropertyIds(organizationId: string, memberId: string): Promise<string[]> {
    const [teamRoots, directRoots] = await Promise.all([
      this.prisma.teamProperty.findMany({
        where: { organizationId, team: { members: { some: { memberId } } } },
        select: { propertyId: true },
      }),
      this.prisma.memberProperty.findMany({
        where: { organizationId, memberId },
        select: { propertyId: true },
      }),
    ]);
    const ids = new Set<string>([
      ...teamRoots.map((r) => r.propertyId),
      ...directRoots.map((r) => r.propertyId),
    ]);
    return [...ids];
  }
}
