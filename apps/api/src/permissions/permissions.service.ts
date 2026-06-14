import { HttpStatus, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Team } from '@prisma/client';
import { AccessSummaryDto, MemberPropertyDto, TeamDto, TeamMemberDto, TeamPropertyDto, WS_EVENTS } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { OrgMemberContext } from '../organizations/org-context.types';
import { AuditService } from '../audit/audit.service';
import { IRealtimeService, REALTIME_SERVICE } from '../realtime/realtime.types';
import { PermissionsRepository } from './permissions.repository';
import { CreateTeamDto } from './permissions.dto';

function toTeamDto(team: Team): TeamDto {
  return {
    id: team.id,
    organizationId: team.organizationId,
    name: team.name,
    creatorMemberId: team.creatorMemberId,
    version: team.version,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

@Injectable()
export class PermissionsService {
  constructor(
    private readonly repo: PermissionsRepository,
    private readonly audit: AuditService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private realtime(): IRealtimeService {
    return this.moduleRef.get<IRealtimeService>(REALTIME_SERVICE, { strict: false });
  }

  effectiveRoots(organizationId: string, memberId: string): Promise<string[]> {
    return this.repo.effectiveRootPropertyIds(organizationId, memberId);
  }

  /** Every property id the member is scoped to: the union of each assigned root's subtree. */
  async scopePropertyIds(organizationId: string, memberId: string): Promise<string[]> {
    const roots = await this.repo.effectiveRootPropertyIds(organizationId, memberId);
    const subtrees = await Promise.all(
      roots.map((root) => this.repo.subtreePropertyIds(organizationId, root)),
    );
    return [...new Set(subtrees.flat())];
  }

  async inScope(organizationId: string, memberId: string, propertyId: string): Promise<boolean> {
    const ids = await this.scopePropertyIds(organizationId, memberId);
    return ids.includes(propertyId);
  }

  /** Spec §5 write decision. OWNER: always. MEMBER: never (ORG_003). ADMIN: only in scope (PERM_001). */
  async assertCanConfigure(member: OrgMemberContext, governingSiteId: string): Promise<void> {
    if (member.role === 'OWNER') return;
    if (member.role === 'MEMBER') {
      throw new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', HttpStatus.FORBIDDEN);
    }
    // ADMIN
    if (!(await this.inScope(member.organizationId, member.id, governingSiteId))) {
      throw new NodeScopeException('PERM_001', 'OUTSIDE_ASSIGNED_SCOPE', HttpStatus.FORBIDDEN);
    }
  }

  /** For repositories to AND into site-bound reads. `null` => unscoped (OWNER): no filter. */
  async scopeFilter(member: OrgMemberContext): Promise<{ propertyIdIn: string[] } | null> {
    if (member.role === 'OWNER') return null;
    return { propertyIdIn: await this.scopePropertyIds(member.organizationId, member.id) };
  }

  /** Network-level op: OWNER always; MEMBER → ORG_003; ADMIN must cover EVERY chartered site → else PERM_004. */
  async assertNetworkFullCoverage(member: OrgMemberContext, charteredPropertyIds: string[]): Promise<void> {
    if (member.role === 'OWNER') return;
    if (member.role === 'MEMBER') {
      throw new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', HttpStatus.FORBIDDEN);
    }
    for (const propertyId of charteredPropertyIds) {
      if (!(await this.inScope(member.organizationId, member.id, propertyId))) {
        throw new NodeScopeException('PERM_004', 'NETWORK_PARTIAL_SCOPE', HttpStatus.FORBIDDEN);
      }
    }
  }

  /** Sites an actor may delegate = the actor's own scope. OWNER unlimited. Beyond ⇒ PERM_002. */
  async assertWithinGrantorScope(actor: OrgMemberContext, propertyIds: string[]): Promise<void> {
    if (actor.role === 'OWNER') return;
    for (const pid of propertyIds) {
      if (!(await this.inScope(actor.organizationId, actor.id, pid))) {
        throw new NodeScopeException('PERM_002', 'SCOPE_EXCEEDS_GRANTOR', HttpStatus.FORBIDDEN);
      }
    }
  }

  /** OWNER manages anyone; ADMIN manages MEMBERs only. Else PERM_003. (Role CHANGES stay OWNER-only — enforce at the call site.) */
  assertCanManageMember(actor: OrgMemberContext, target: OrgMemberContext): void {
    if (actor.role === 'OWNER') return;
    if (actor.role === 'ADMIN' && target.role === 'MEMBER') return;
    throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
  }

  /** Team structure (rename/delete/assign-sites): OWNER any; ADMIN iff they CREATED the team AND every site ⊆ their scope. */
  async assertCanManageTeamStructure(actor: OrgMemberContext, team: Team, teamPropertyIds: string[]): Promise<void> {
    if (actor.role === 'OWNER') return;
    if (actor.role !== 'ADMIN' || team.creatorMemberId !== actor.id) {
      throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
    }
    await this.assertWithinGrantorScope(actor, teamPropertyIds); // PERM_002 if any site beyond scope
  }

  /** Team membership (add/remove members): OWNER any; ADMIN iff the team's sites are ALL within their scope (creator or not). */
  async assertCanManageTeamMembership(actor: OrgMemberContext, teamPropertyIds: string[]): Promise<void> {
    if (actor.role === 'OWNER') return;
    if (actor.role !== 'ADMIN') throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
    for (const pid of teamPropertyIds) {
      if (!(await this.inScope(actor.organizationId, actor.id, pid))) {
        throw new NodeScopeException('PERM_003', 'CANNOT_MANAGE_TARGET', HttpStatus.FORBIDDEN);
      }
    }
  }

  async accessSummary(member: OrgMemberContext): Promise<AccessSummaryDto> {
    const unscoped = member.role === 'OWNER';
    return {
      role: member.role,
      assignedRootPropertyIds: unscoped
        ? []
        : await this.repo.effectiveRootPropertyIds(member.organizationId, member.id),
      unscoped,
    };
  }

  async listTeams(member: OrgMemberContext): Promise<TeamDto[]> {
    const scope = await this.scopeFilter(member);
    return (await this.repo.listVisibleTeams(member.organizationId, scope)).map(toTeamDto);
  }

  async createTeamFor(actor: OrgMemberContext, dto: CreateTeamDto): Promise<TeamDto> {
    if (actor.role === 'MEMBER') throw new NodeScopeException('ORG_003', 'FORBIDDEN_ROLE', HttpStatus.FORBIDDEN);
    try {
      const team = await this.repo.createTeam({ organizationId: actor.organizationId, name: dto.name, creatorMemberId: actor.id });
      await this.audit.recordCreate(actor.organizationId, 'Team', team);
      // New team has no sites → emit to OWNER-only (empty site list)
      await this.realtime().emitScopedMulti(actor.organizationId, [], WS_EVENTS.TEAM_CREATED, { id: team.id });
      return toTeamDto(team);
    } catch (e) {
      if (isUniqueViolation(e)) throw new NodeScopeException('TEAM_002', 'TEAM_NAME_TAKEN', HttpStatus.CONFLICT);
      throw e;
    }
  }

  async renameTeamFor(actor: OrgMemberContext, teamId: string, baseVersion: number, name: string): Promise<TeamDto> {
    const team = await this.loadTeamOr404(actor.organizationId, teamId);
    await this.assertCanManageTeamStructure(actor, team, await this.repo.teamPropertyIds(actor.organizationId, teamId));
    let result;
    try {
      result = await this.repo.renameTeam(actor.organizationId, teamId, name, baseVersion);
    } catch (e) {
      if (isUniqueViolation(e)) throw new NodeScopeException('TEAM_002', 'TEAM_NAME_TAKEN', HttpStatus.CONFLICT);
      throw e;
    }
    if (result.count === 0) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    const updated = await this.loadTeamOr404(actor.organizationId, teamId);
    await this.audit.recordUpdate(actor.organizationId, 'Team', teamId, [{ field: 'name', oldValue: team.name, newValue: name }]);
    await this.realtime().emitScopedMulti(
      actor.organizationId,
      await this.repo.teamPropertyIds(actor.organizationId, teamId),
      WS_EVENTS.TEAM_UPDATED,
      { id: teamId },
    );
    return toTeamDto(updated);
  }

  async deleteTeamFor(actor: OrgMemberContext, teamId: string): Promise<void> {
    const team = await this.loadTeamOr404(actor.organizationId, teamId);
    await this.assertCanManageTeamStructure(actor, team, await this.repo.teamPropertyIds(actor.organizationId, teamId));
    // Capture before delete — once deleted, the rows are gone
    const sites = await this.repo.teamPropertyIds(actor.organizationId, teamId);
    const userIds = await this.repo.teamMemberUserIds(actor.organizationId, teamId);
    await this.repo.deleteTeam(actor.organizationId, teamId);
    await this.audit.recordDelete(actor.organizationId, 'Team', team);
    await this.realtime().emitScopedMulti(actor.organizationId, sites, WS_EVENTS.TEAM_DELETED, { id: teamId });
    for (const uid of userIds) {
      this.realtime().notifyAccessChanged(actor.organizationId, uid);
    }
  }

  async addMemberToTeam(actor: OrgMemberContext, teamId: string, memberId: string): Promise<TeamMemberDto> {
    await this.loadTeamOr404(actor.organizationId, teamId);
    await this.assertCanManageTeamMembership(actor, await this.repo.teamPropertyIds(actor.organizationId, teamId));
    const target = await this.repo.findMemberById(actor.organizationId, memberId);
    if (!target) throw new NodeScopeException('ORG_001', 'NOT_A_MEMBER', HttpStatus.NOT_FOUND);
    this.assertCanManageMember(actor, target);
    const existing = await this.repo.findTeamMember(actor.organizationId, teamId, memberId);
    if (existing) return { id: existing.id, teamId, memberId };
    const tm = await this.repo.addTeamMember({ organizationId: actor.organizationId, teamId, memberId });
    await this.audit.recordCreate(actor.organizationId, 'TeamMember', tm);
    await this.realtime().emitScopedMulti(
      actor.organizationId,
      await this.repo.teamPropertyIds(actor.organizationId, teamId),
      WS_EVENTS.TEAM_MEMBER_ADDED,
      { teamId, memberId },
    );
    this.realtime().notifyAccessChanged(actor.organizationId, target.userId);
    return { id: tm.id, teamId, memberId };
  }

  async removeMemberFromTeam(actor: OrgMemberContext, teamId: string, memberId: string): Promise<void> {
    await this.loadTeamOr404(actor.organizationId, teamId);
    await this.assertCanManageTeamMembership(actor, await this.repo.teamPropertyIds(actor.organizationId, teamId));
    const target = await this.repo.findMemberById(actor.organizationId, memberId);
    if (target) this.assertCanManageMember(actor, target);
    const existing = await this.repo.findTeamMember(actor.organizationId, teamId, memberId);
    await this.repo.removeTeamMember(actor.organizationId, teamId, memberId);
    if (existing) await this.audit.recordDelete(actor.organizationId, 'TeamMember', existing);
    await this.realtime().emitScopedMulti(
      actor.organizationId,
      await this.repo.teamPropertyIds(actor.organizationId, teamId),
      WS_EVENTS.TEAM_MEMBER_REMOVED,
      { teamId, memberId },
    );
    if (target) this.realtime().notifyAccessChanged(actor.organizationId, target.userId);
  }

  async assignSiteToTeam(actor: OrgMemberContext, teamId: string, propertyId: string): Promise<TeamPropertyDto> {
    const team = await this.loadTeamOr404(actor.organizationId, teamId);
    await this.assertCanManageTeamStructure(actor, team, await this.repo.teamPropertyIds(actor.organizationId, teamId));
    await this.assertWithinGrantorScope(actor, [propertyId]);
    const existing = await this.repo.findTeamProperty(actor.organizationId, teamId, propertyId);
    if (existing) return { id: existing.id, teamId, propertyId };
    const userIds = await this.repo.teamMemberUserIds(actor.organizationId, teamId);
    const tp = await this.repo.addTeamProperty({ organizationId: actor.organizationId, teamId, propertyId });
    await this.audit.recordCreate(actor.organizationId, 'TeamProperty', tp);
    await this.realtime().emitScopedMulti(
      actor.organizationId,
      await this.repo.teamPropertyIds(actor.organizationId, teamId),
      WS_EVENTS.TEAM_PROPERTY_ASSIGNED,
      { teamId, propertyId },
    );
    for (const uid of userIds) {
      this.realtime().notifyAccessChanged(actor.organizationId, uid);
    }
    return { id: tp.id, teamId, propertyId };
  }

  async unassignSiteFromTeam(actor: OrgMemberContext, teamId: string, propertyId: string): Promise<void> {
    const team = await this.loadTeamOr404(actor.organizationId, teamId);
    await this.assertCanManageTeamStructure(actor, team, await this.repo.teamPropertyIds(actor.organizationId, teamId));
    const existing = await this.repo.findTeamProperty(actor.organizationId, teamId, propertyId);
    const userIds = await this.repo.teamMemberUserIds(actor.organizationId, teamId);
    await this.repo.removeTeamProperty(actor.organizationId, teamId, propertyId);
    if (existing) await this.audit.recordDelete(actor.organizationId, 'TeamProperty', existing);
    await this.realtime().emitScopedMulti(
      actor.organizationId,
      await this.repo.teamPropertyIds(actor.organizationId, teamId),
      WS_EVENTS.TEAM_PROPERTY_UNASSIGNED,
      { teamId, propertyId },
    );
    for (const uid of userIds) {
      this.realtime().notifyAccessChanged(actor.organizationId, uid);
    }
  }

  async grantSiteToMember(actor: OrgMemberContext, memberId: string, propertyId: string): Promise<MemberPropertyDto> {
    const target = await this.repo.findMemberById(actor.organizationId, memberId);
    if (!target) throw new NodeScopeException('ORG_001', 'NOT_A_MEMBER', HttpStatus.NOT_FOUND);
    this.assertCanManageMember(actor, target);                 // ADMIN → MEMBER only (PERM_003)
    await this.assertWithinGrantorScope(actor, [propertyId]);  // site ⊆ actor scope (PERM_002)
    const existing = await this.repo.findMemberProperty(actor.organizationId, memberId, propertyId);
    if (existing) return { id: existing.id, memberId, propertyId }; // idempotent
    const mp = await this.repo.addMemberProperty({ organizationId: actor.organizationId, memberId, propertyId });
    await this.audit.recordCreate(actor.organizationId, 'MemberProperty', mp);
    await this.realtime().emitScoped(actor.organizationId, propertyId, WS_EVENTS.MEMBER_PROPERTY_ASSIGNED, { memberId, propertyId });
    this.realtime().notifyAccessChanged(actor.organizationId, target.userId);
    return { id: mp.id, memberId, propertyId };
  }

  async revokeSiteFromMember(actor: OrgMemberContext, memberId: string, propertyId: string): Promise<void> {
    const target = await this.repo.findMemberById(actor.organizationId, memberId);
    if (target) this.assertCanManageMember(actor, target);
    await this.assertWithinGrantorScope(actor, [propertyId]); // can only revoke within own scope
    const existing = await this.repo.findMemberProperty(actor.organizationId, memberId, propertyId);
    await this.repo.removeMemberProperty(actor.organizationId, memberId, propertyId);
    if (existing) await this.audit.recordDelete(actor.organizationId, 'MemberProperty', existing);
    await this.realtime().emitScoped(actor.organizationId, propertyId, WS_EVENTS.MEMBER_PROPERTY_UNASSIGNED, { memberId, propertyId });
    if (target) this.realtime().notifyAccessChanged(actor.organizationId, target.userId);
  }

  /** A target member's access AS SEEN BY the actor: OWNER sees all the target's roots; an ADMIN sees only the slice ⊆ their own scope. */
  async memberAccessAsSeenBy(actor: OrgMemberContext, memberId: string): Promise<AccessSummaryDto> {
    const target = await this.repo.findMemberById(actor.organizationId, memberId);
    if (!target) throw new NodeScopeException('ORG_001', 'NOT_A_MEMBER', HttpStatus.NOT_FOUND);
    this.assertCanManageMember(actor, target);
    const roots = await this.repo.effectiveRootPropertyIds(actor.organizationId, memberId);
    if (actor.role === 'OWNER') return { role: target.role, assignedRootPropertyIds: roots, unscoped: false };
    const actorScope = new Set(await this.scopePropertyIds(actor.organizationId, actor.id));
    return { role: target.role, assignedRootPropertyIds: roots.filter((r) => actorScope.has(r)), unscoped: false };
  }

  private async loadTeamOr404(organizationId: string, teamId: string): Promise<Team> {
    const team = await this.repo.findTeam(organizationId, teamId);
    if (!team) throw new NodeScopeException('TEAM_001', 'TEAM_NOT_FOUND', HttpStatus.NOT_FOUND);
    return team;
  }
}
