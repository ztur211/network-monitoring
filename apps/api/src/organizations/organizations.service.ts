import { HttpStatus, Injectable } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { OrganizationDto, OrganizationMemberDto } from '@nodescope/shared';
import { OrganizationsRepository } from './organizations.repository';
import { UsersRepository } from '../users/users.repository';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { CreateOrganizationDto, PatchOrganizationDto, ORG_WRITABLE_FIELDS } from './organizations.dto';

@Injectable()
export class OrganizationsService {
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

  private toDto(o: {
    id: string;
    name: string;
    namingPattern: string | null;
    namingMaxLen: number | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): OrganizationDto {
    return {
      id: o.id,
      name: o.name,
      namingPattern: o.namingPattern,
      namingMaxLen: o.namingMaxLen,
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
