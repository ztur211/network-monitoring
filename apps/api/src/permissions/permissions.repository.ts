import { Injectable } from '@nestjs/common';
import { Team, TeamMember, TeamProperty, MemberProperty, OrganizationMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyTreeRepository } from '../property-tree/property-tree.repository';

@Injectable()
export class PermissionsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: PropertyTreeRepository,
  ) {}

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

  /** The property + all descendants (org-scoped), via a recursive CTE.
   *  Mirrors PropertiesRepository.getSubtreeIds — kept here to avoid a circular
   *  module dependency between PermissionsModule and PropertiesModule. */
  async subtreePropertyIds(organizationId: string, rootId: string): Promise<string[]> {
    // Org filter is re-asserted on the recursive step (defence-in-depth), matching
    // PropertyTreeRepository.ancestorIds — so the walk can never cross into another org
    // even if a row's parentId ever pointed outside it. This CTE backs scopePropertyIds,
    // the basis of every F3 authorization decision.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM "Property" WHERE id = ${rootId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p.id FROM "Property" p JOIN subtree s ON p."parentId" = s.id AND p."organizationId" = ${organizationId}
      )
      SELECT id FROM subtree;
    `;
    return rows.map((r) => r.id);
  }

  /** The property and every ancestor up to the root (org-scoped). Used by the scoped realtime
   *  fan-out to resolve which sockets should receive an event when a node is mutated. Delegates to
   *  the shared PropertyTreeRepository (single source of the upward CTE). */
  ancestorPropertyIds(organizationId: string, propertyId: string): Promise<string[]> {
    return this.tree.ancestorIds(organizationId, propertyId);
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

  findTeam(organizationId: string, teamId: string): Promise<Team | null> {
    return this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
  }

  async teamPropertyIds(organizationId: string, teamId: string): Promise<string[]> {
    const rows = await this.prisma.teamProperty.findMany({ where: { organizationId, teamId }, select: { propertyId: true } });
    return rows.map((r) => r.propertyId);
  }

  listVisibleTeams(organizationId: string, scope: { propertyIdIn: string[] } | null): Promise<Team[]> {
    return this.prisma.team.findMany({
      where: { organizationId, ...(scope ? { properties: { some: { propertyId: { in: scope.propertyIdIn } } } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  renameTeam(organizationId: string, teamId: string, name: string, expectedVersion: number) {
    return this.prisma.team.updateMany({ where: { id: teamId, organizationId, version: expectedVersion }, data: { name, version: { increment: 1 } } });
  }

  deleteTeam(organizationId: string, teamId: string) {
    return this.prisma.team.deleteMany({ where: { id: teamId, organizationId } });
  }

  removeTeamMember(organizationId: string, teamId: string, memberId: string) {
    return this.prisma.teamMember.deleteMany({ where: { organizationId, teamId, memberId } });
  }

  findTeamMember(organizationId: string, teamId: string, memberId: string): Promise<TeamMember | null> {
    return this.prisma.teamMember.findFirst({ where: { organizationId, teamId, memberId } });
  }

  findMemberById(organizationId: string, memberId: string): Promise<OrganizationMember | null> {
    return this.prisma.organizationMember.findFirst({ where: { id: memberId, organizationId } });
  }

  removeTeamProperty(organizationId: string, teamId: string, propertyId: string) {
    return this.prisma.teamProperty.deleteMany({ where: { organizationId, teamId, propertyId } });
  }

  findTeamProperty(organizationId: string, teamId: string, propertyId: string): Promise<TeamProperty | null> {
    return this.prisma.teamProperty.findFirst({ where: { organizationId, teamId, propertyId } });
  }

  removeMemberProperty(organizationId: string, memberId: string, propertyId: string) {
    return this.prisma.memberProperty.deleteMany({ where: { organizationId, memberId, propertyId } });
  }

  findMemberProperty(organizationId: string, memberId: string, propertyId: string): Promise<MemberProperty | null> {
    return this.prisma.memberProperty.findFirst({ where: { organizationId, memberId, propertyId } });
  }

  async teamMemberUserIds(organizationId: string, teamId: string): Promise<string[]> {
    const rows = await this.prisma.teamMember.findMany({
      where: { organizationId, teamId },
      select: { member: { select: { userId: true } } },
    });
    return rows.map((r) => r.member.userId);
  }
}
