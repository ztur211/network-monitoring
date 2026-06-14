import { HttpStatus, Injectable } from '@nestjs/common';
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
