import { HttpStatus, Injectable } from '@nestjs/common';
import { Team } from '@prisma/client';
import { AccessSummaryDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsRepository } from './permissions.repository';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly repo: PermissionsRepository,
  ) {}

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
}
