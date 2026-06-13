import { HttpStatus, Injectable } from '@nestjs/common';
import { Property, PropertyType } from '@prisma/client';
import { PropertyDto, WS_EVENTS } from '@nodescope/shared';
import { PropertiesRepository } from './properties.repository';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { assertValidNesting } from './property-nesting';
import { CreatePropertyDto, PatchPropertyDto, PROPERTY_WRITABLE_FIELDS } from './properties.dto';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly repo: PropertiesRepository,
    private readonly conflict: ConflictResolutionService,
    private readonly audit: AuditService,
  ) {}

  async listProperties(organizationId: string): Promise<PropertyDto[]> {
    return (await this.repo.findAllByOrgId(organizationId)).map((p) => this.toDto(p));
  }

  async getProperty(organizationId: string, id: string): Promise<PropertyDto> {
    const p = await this.repo.findByIdAndOrgId(id, organizationId);
    if (!p) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.toDto(p);
  }

  async createProperty(organizationId: string, dto: CreatePropertyDto): Promise<PropertyDto> {
    const parentType = await this.resolveParentType(organizationId, dto.parentId ?? null);
    assertValidNesting(parentType, dto.type);
    if (await this.repo.existsSiblingName(organizationId, dto.parentId ?? null, dto.name)) {
      throw new NodeScopeException('PROP_003', 'PROPERTY_NAME_TAKEN', HttpStatus.CONFLICT);
    }
    const created = await this.repo.create({
      organizationId, parentId: dto.parentId ?? null, type: dto.type, name: dto.name, code: dto.code ?? null,
    });
    this.conflict.emitEntityEvent(WS_EVENTS.PROPERTY_CREATED, { id: created.id }, organizationId);
    await this.audit.recordCreate(organizationId, 'Property', created);
    return this.toDto(created);
  }

  async updateProperty(organizationId: string, id: string, patch: PatchPropertyDto): Promise<PropertyDto> {
    const current = await this.repo.findByIdAndOrgId(id, organizationId);
    if (!current) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);

    const changedField = (f: string) => patch.changes.find((c) => c.field === f);
    const parentChange = changedField('parentId');
    const nameChange = changedField('name');

    const nextParentId = parentChange ? ((parentChange.newValue as string | null) ?? null) : current.parentId;

    if (parentChange) {
      // cycle: the new parent must not be the node itself or any of its descendants
      if (nextParentId) {
        if (nextParentId === id) throw new NodeScopeException('PROP_005', 'PROPERTY_CYCLE', HttpStatus.UNPROCESSABLE_ENTITY);
        const subtree = await this.repo.getSubtreeIds(organizationId, id);
        if (subtree.includes(nextParentId)) throw new NodeScopeException('PROP_005', 'PROPERTY_CYCLE', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const newParentType = await this.resolveParentType(organizationId, nextParentId);
      assertValidNesting(newParentType, current.type);
      // NOTE: containment re-validation (devices/charters) is added in Phase B.
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

    const event = parentChange ? WS_EVENTS.PROPERTY_MOVED : WS_EVENTS.PROPERTY_UPDATED;
    this.conflict.emitEntityEvent(event, { id }, organizationId);
    await this.audit.recordUpdate(organizationId, 'Property', id, patch.changes);
    return this.toDto(updated);
  }

  async deleteProperty(organizationId: string, id: string): Promise<void> {
    const p = await this.repo.findByIdAndOrgId(id, organizationId);
    if (!p) throw new NodeScopeException('PROP_001', 'PROPERTY_NOT_FOUND', HttpStatus.NOT_FOUND);
    if ((await this.repo.countChildren(organizationId, id)) > 0) {
      throw new NodeScopeException('PROP_004', 'PROPERTY_NOT_EMPTY', HttpStatus.CONFLICT);
    }
    // NOTE: Phase B also blocks on placed devices and network charters before deleting.
    await this.repo.deleteByIdAndOrgId(id, organizationId);
    this.conflict.emitEntityEvent(WS_EVENTS.PROPERTY_DELETED, { id }, organizationId);
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
