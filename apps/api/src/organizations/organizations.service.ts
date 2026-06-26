import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { OrganizationDto, OrganizationMemberDto, WS_EVENTS } from '@nodescope/shared';
import { OrganizationsRepository } from './organizations.repository';
import { UsersRepository } from '../users/users.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { CreateOrganizationDto, PatchOrganizationDto, ORG_WRITABLE_FIELDS } from './organizations.dto';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly repo: OrganizationsRepository,
    private readonly users: UsersRepository,
    private readonly conflict: ConflictResolutionService,
  ) {}

  async provisionOrganization(dto: CreateOrganizationDto): Promise<OrganizationDto> {
    const org = await this.repo.createOrganization({ name: dto.name });
    return this.toDto(org);
  }

  async addDomain(organizationId: string, domain: string): Promise<void> {
    const normalized = domain.trim().toLowerCase();
    const existing = await this.repo.findOrganizationByDomain(normalized);
    if (existing) {
      throw new NodeScopeException('ORG_004', 'DOMAIN_ALREADY_CLAIMED', HttpStatus.CONFLICT);
    }
    const org = await this.repo.findOrganizationById(organizationId);
    if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.repo.addDomain(organizationId, normalized);
  }

  async designateOwner(organizationId: string, email: string): Promise<OrganizationMemberDto> {
    const org = await this.repo.findOrganizationById(organizationId);
    if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    const user = await this.users.findByEmail(email);
    if (!user) throw new NodeScopeException('ORG_001', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    const existing = await this.repo.findMemberByUserId(user.id);
    if (existing) {
      throw new NodeScopeException('ORG_003', 'USER_ALREADY_IN_ORG', HttpStatus.CONFLICT);
    }
    const member = await this.repo.createMember(user.id, organizationId, OrgRole.OWNER);
    return this.toMemberDto(member);
  }

  async getMyOrganization(userId: string): Promise<OrganizationDto> {
    const member = await this.repo.findMemberByUserId(userId);
    if (!member) throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.FORBIDDEN);
    const org = await this.repo.findOrganizationById(member.organizationId);
    if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.toDto(org);
  }

  async getMyMembers(organizationId: string): Promise<OrganizationMemberDto[]> {
    const members = await this.repo.findMembersByOrganizationId(organizationId);
    return members.map((m) => this.toMemberDto(m));
  }

  async updateMyOrganization(organizationId: string, patch: PatchOrganizationDto): Promise<OrganizationDto> {
    const org = await this.repo.findOrganizationById(organizationId);
    if (!org) throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    const updatePayload = this.conflict.buildUpdatePayload(
      patch,
      ORG_WRITABLE_FIELDS,
      org.version,
      CreateOrganizationDto,
    );
    const updated = await this.repo.updateOrganizationWithVersion(organizationId, updatePayload, patch.baseVersion);
    if (!updated) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    return this.toDto(updated);
  }

  private assertCanManage(actorRole: OrgRole, targetCurrentRole: OrgRole, nextRole?: OrgRole): void {
    if (actorRole === 'OWNER') return;
    if (actorRole === 'ADMIN') {
      const touchesPrivileged =
        targetCurrentRole !== 'MEMBER' || (nextRole !== undefined && nextRole !== 'MEMBER');
      if (touchesPrivileged) {
        throw new NodeScopeException('ORG_003', 'INSUFFICIENT_ORG_ROLE', HttpStatus.FORBIDDEN);
      }
      return;
    }
    throw new NodeScopeException('ORG_003', 'INSUFFICIENT_ORG_ROLE', HttpStatus.FORBIDDEN);
  }

  async changeMemberRole(
    organizationId: string,
    actorRole: OrgRole,
    targetUserId: string,
    nextRole: OrgRole,
  ): Promise<void> {
    const target = await this.repo.findMemberByUserAndOrg(targetUserId, organizationId);
    if (!target) {
      throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.NOT_FOUND);
    }
    this.assertCanManage(actorRole, target.role, nextRole);
    if (
      target.role === 'OWNER' &&
      nextRole !== 'OWNER' &&
      (await this.repo.countOwners(organizationId)) <= 1
    ) {
      throw new NodeScopeException('ORG_013', 'LAST_OWNER_PROTECTED', HttpStatus.CONFLICT);
    }
    await this.repo.updateMemberRole(targetUserId, organizationId, nextRole);
    this.conflict.emitEntityEvent(
      WS_EVENTS.ORG_MEMBER_UPDATED,
      { userId: targetUserId, role: nextRole },
      organizationId,
    );
  }

  async removeMember(
    organizationId: string,
    actorRole: OrgRole,
    targetUserId: string,
  ): Promise<void> {
    const target = await this.repo.findMemberByUserAndOrg(targetUserId, organizationId);
    if (!target) {
      throw new NodeScopeException('ORG_002', 'NOT_AN_ORG_MEMBER', HttpStatus.NOT_FOUND);
    }
    this.assertCanManage(actorRole, target.role);
    if (target.role === 'OWNER' && (await this.repo.countOwners(organizationId)) <= 1) {
      throw new NodeScopeException('ORG_013', 'LAST_OWNER_PROTECTED', HttpStatus.CONFLICT);
    }
    await this.repo.deleteMember(targetUserId, organizationId);
    this.conflict.emitEntityEvent(
      WS_EVENTS.ORG_MEMBER_REMOVED,
      { userId: targetUserId },
      organizationId,
    );
    // Emit the removal event first (so the member's still-connected client can react),
    // then evict: their socket's orgId is fixed at connection time, so without this a
    // removed member keeps receiving org broadcasts and can keep ingesting metrics into
    // the org until they happen to disconnect. Best-effort: the membership row is already
    // gone (the authoritative state), so a realtime/Redis hiccup must not fail an
    // otherwise-successful removal — log and move on. A still-connected socket re-resolves
    // to no-org on its next reconnect regardless.
    try {
      await this.conflict.evictOrgMember(organizationId, targetUserId);
    } catch (err) {
      this.logger.error(
        { err, organizationId, targetUserId },
        'Failed to evict removed member sockets — membership is already deleted',
      );
    }
  }

  private toDto(o: {
    id: string;
    name: string;
    namingPattern: string | null;
    namingMaxLen: number | null;
    namingTemplate: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): OrganizationDto {
    return {
      id: o.id,
      name: o.name,
      namingPattern: o.namingPattern,
      namingMaxLen: o.namingMaxLen,
      namingTemplate: o.namingTemplate,
      version: o.version,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  private toMemberDto(m: {
    id: string;
    userId: string;
    organizationId: string;
    role: OrgRole;
    createdAt: Date;
  }): OrganizationMemberDto {
    return {
      id: m.id,
      userId: m.userId,
      organizationId: m.organizationId,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
