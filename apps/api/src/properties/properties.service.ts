import { HttpStatus, Injectable } from '@nestjs/common';
import { Property, PropertyType } from '@prisma/client';
import { PropertyDto, WS_EVENTS } from '@nodescope/shared';
import { PropertiesRepository } from './properties.repository';
import { ContainmentService } from './containment.service';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { assertValidNesting } from './property-nesting';
import { CreatePropertyDto, PatchPropertyDto, PROPERTY_WRITABLE_FIELDS } from './properties.dto';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly repo: PropertiesRepository,
    private readonly conflict: ConflictResolutionService,
    private readonly audit: AuditService,
    private readonly containment: ContainmentService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Org-scoped row lookup for cross-module callers (Spec 1 building-models). No permission-scope filter. */
  findInOrg(organizationId: string, id: string): Promise<Property | null> {
    return this.repo.findByIdAndOrgId(id, organizationId);
  }

  async listProperties(member: OrgMemberContext): Promise<PropertyDto[]> {
    const scope = await this.permissions.scopeFilter(member);
    return (await this.repo.findAllByOrgId(member.organizationId, scope)).map((p) => this.toDto(p));
  }

  async getProperty(member: OrgMemberContext, id: string): Promise<PropertyDto> {
    const scope = await this.permissions.scopeFilter(member);
    const p = await this.repo.findByIdAndOrgId(id, member.organizationId, scope);
    if (!p) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.toDto(p);
  }

  async createProperty(member: OrgMemberContext, dto: CreatePropertyDto): Promise<PropertyDto> {
    const organizationId = member.organizationId;
    // Top-level SITE: OWNER-only; sub-site: assertCanConfigure the parent
    if (dto.parentId == null) {
      await this.permissions.assertCanConfigure(member, '__root__');
    } else {
      await this.permissions.assertCanConfigure(member, dto.parentId);
    }

    const parentType = await this.resolveParentType(organizationId, dto.parentId ?? null);
    assertValidNesting(parentType, dto.type);
    if (await this.repo.existsSiblingName(organizationId, dto.parentId ?? null, dto.name)) {
      throw new NodeScopeException('PROP_003', 'PROPERTY_NAME_TAKEN', HttpStatus.CONFLICT);
    }
    const created = await this.repo.create({
      organizationId, parentId: dto.parentId ?? null, type: dto.type, name: dto.name, code: dto.code ?? null,
    });
    await this.conflict.emitScoped(organizationId, created.id, WS_EVENTS.PROPERTY_CREATED, { id: created.id });
    await this.audit.recordCreate(organizationId, 'Property', created);
    return this.toDto(created);
  }

  async updateProperty(member: OrgMemberContext, id: string, patch: PatchPropertyDto): Promise<PropertyDto> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup (no scope) so out-of-scope ADMIN → PERM_001 not 404
    const current = await this.repo.findByIdAndOrgId(id, organizationId);
    if (!current) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.permissions.assertCanConfigure(member, current.id);

    const changedField = (f: string) => patch.changes.find((c) => c.field === f);
    const parentChange = changedField('parentId');
    const nameChange = changedField('name');

    const nextParentId = parentChange ? ((parentChange.newValue as string | null) ?? null) : current.parentId;

    if (parentChange) {
      // If reparenting, also assert access to the destination
      if (nextParentId == null) {
        // Promoting to top-level is OWNER-only
        await this.permissions.assertCanConfigure(member, '__root__');
      } else {
        await this.permissions.assertCanConfigure(member, nextParentId);
      }

      // cycle: the new parent must not be the node itself or any of its descendants
      if (nextParentId) {
        if (nextParentId === id) throw new NodeScopeException('PROP_005', 'PROPERTY_CYCLE', HttpStatus.UNPROCESSABLE_ENTITY);
        const subtree = await this.repo.getSubtreeIds(organizationId, id);
        if (subtree.includes(nextParentId)) throw new NodeScopeException('PROP_005', 'PROPERTY_CYCLE', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const newParentType = await this.resolveParentType(organizationId, nextParentId);
      assertValidNesting(newParentType, current.type);
      await this.containment.assertReparentKeepsContainment(organizationId, id, nextParentId);
    }

    if (nameChange || parentChange) {
      const nextName = nameChange ? (nameChange.newValue as string) : current.name;
      if (await this.repo.existsSiblingName(organizationId, nextParentId, nextName, id)) {
        throw new NodeScopeException('PROP_003', 'PROPERTY_NAME_TAKEN', HttpStatus.CONFLICT);
      }
    }

    const payload = this.conflict.buildUpdatePayload(patch, PROPERTY_WRITABLE_FIELDS, current.version, CreatePropertyDto);
    const updated = await this.repo.updateWithVersion(id, organizationId, payload, patch.baseVersion);
    if (!updated) throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);

    if (parentChange) {
      const oldParentId = current.parentId;
      await this.conflict.emitScopedMulti(
        organizationId,
        [id, oldParentId].filter((x): x is string => !!x),
        WS_EVENTS.PROPERTY_MOVED,
        { id },
      );
    } else {
      await this.conflict.emitScoped(organizationId, id, WS_EVENTS.PROPERTY_UPDATED, { id });
    }
    await this.audit.recordUpdate(organizationId, 'Property', id, patch.changes);
    return this.toDto(updated);
  }

  async deleteProperty(member: OrgMemberContext, id: string): Promise<void> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup (no scope) so out-of-scope ADMIN → PERM_001 not 404
    const p = await this.repo.findByIdAndOrgId(id, organizationId);
    if (!p) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.permissions.assertCanConfigure(member, p.id);
    const subtreeIds = await this.repo.getSubtreeIds(organizationId, id);
    const hasChildren = subtreeIds.length > 1;
    const devices = await this.repo.countDevicesUnder(organizationId, subtreeIds);
    const charters = await this.repo.countChartersUnder(organizationId, subtreeIds);
    if (hasChildren || devices > 0 || charters > 0) {
      throw new NodeScopeException('PROP_004', 'PROPERTY_NOT_EMPTY', HttpStatus.CONFLICT);
    }
    const assignments = await this.repo.countAssignmentsUnder(organizationId, subtreeIds);
    if (assignments > 0) {
      throw new NodeScopeException('PERM_005', 'PROPERTY_ASSIGNED', HttpStatus.CONFLICT);
    }
    // Emit BEFORE delete so the ancestor lookup in emitScoped can still resolve the row
    await this.conflict.emitScoped(organizationId, id, WS_EVENTS.PROPERTY_DELETED, { id });
    await this.repo.deleteByIdAndOrgId(id, organizationId);
    await this.audit.recordDelete(organizationId, 'Property', p);
  }

  // ---- helpers exposed for Phase B containment + F3 (spec §10.2) ----
  subtreePropertyIds(organizationId: string, id: string): Promise<string[]> {
    return this.repo.getSubtreeIds(organizationId, id);
  }
  isAtOrUnder(organizationId: string, descendantId: string, ancestorId: string): Promise<boolean> {
    return this.repo.isAtOrUnder(organizationId, descendantId, ancestorId);
  }

  private async resolveParentType(organizationId: string, parentId: string | null): Promise<PropertyType | null> {
    if (!parentId) return null;
    // Internal call: no scope — must see the full org tree for nesting validation
    const parent = await this.repo.findByIdAndOrgId(parentId, organizationId);
    if (!parent) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    return parent.type;
  }

  private toDto(p: Property): PropertyDto {
    return {
      id: p.id, organizationId: p.organizationId, parentId: p.parentId, type: p.type,
      name: p.name, code: p.code, version: p.version,
      createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
    };
  }
}
