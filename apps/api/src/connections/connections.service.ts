import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Device, DeviceConnection } from '@prisma/client';
import { DeviceConnectionDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { DevicesRepository } from '../devices/devices.repository';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';
import { CONNECTION_WRITABLE_FIELDS, CreateConnectionDto, PatchConnectionDto } from './connections.dto';
import { ConnectionsRepository } from './connections.repository';

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly connectionsRepository: ConnectionsRepository,
    private readonly devicesRepository: DevicesRepository,
    private readonly conflictService: ConflictResolutionService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async listConnections(member: OrgMemberContext, deviceId?: string): Promise<PaginatedResponse<DeviceConnectionDto>> {
    // `deviceId` is a raw query param; a malformed value (e.g. the array Express
    // parses from `?deviceId[]=a&deviceId[]=b`) would otherwise reach Prisma as an
    // invalid scalar filter and 500. A bad filter is client input → 400.
    if (deviceId !== undefined && !isUUID(deviceId)) {
      throw new NodeScopeException('GEN_001', 'INVALID_DEVICE_ID', HttpStatus.BAD_REQUEST);
    }
    const scope = await this.permissions.scopeFilter(member);
    const items = await this.connectionsRepository.listVisible(member.organizationId, scope, deviceId);
    return { items: items.map((c) => this.toDto(c)), total: items.length };
  }

  async createConnection(
    member: OrgMemberContext,
    creatorUserId: string,
    dto: CreateConnectionDto,
  ): Promise<DeviceConnectionDto> {
    const organizationId = member.organizationId;

    if (dto.sourceDeviceId === dto.targetDeviceId) {
      throw new NodeScopeException('CONN_002', 'SELF_CONNECTION', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const { sourceSiteId, targetSiteId } = await this.resolveEndpointSites(
      organizationId,
      dto.sourceDeviceId,
      dto.targetDeviceId,
    );
    await this.assertBothEndpoints(member, sourceSiteId, targetSiteId);

    const duplicate = await this.connectionsRepository.existsDuplicate(
      organizationId,
      dto.sourceDeviceId,
      dto.targetDeviceId,
      dto.connectionType,
    );
    if (duplicate) {
      throw new NodeScopeException('CONN_003', 'DUPLICATE_CONNECTION', HttpStatus.CONFLICT);
    }

    const connection = await this.connectionsRepository.create({
      organizationId,
      userId: creatorUserId,
      ...dto,
    });
    await this.audit.recordCreate(organizationId, 'DeviceConnection', connection);
    return this.toDto(connection);
  }

  async getConnection(member: OrgMemberContext, connectionId: string): Promise<DeviceConnectionDto> {
    const scope = await this.permissions.scopeFilter(member);
    const connection = await this.connectionsRepository.findVisibleByIdAndOrgId(connectionId, member.organizationId, scope);
    if (!connection) {
      throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(connection);
  }

  async updateConnection(
    member: OrgMemberContext,
    connectionId: string,
    patch: PatchConnectionDto,
  ): Promise<DeviceConnectionDto> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup so out-of-scope ADMIN → PERM_001 not 404
    const connection = await this.connectionsRepository.findByIdAndOrgId(connectionId, organizationId);
    if (!connection) {
      throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const { sourceSiteId, targetSiteId } = await this.resolveEndpointSites(
      organizationId,
      connection.sourceDeviceId,
      connection.targetDeviceId,
    );
    await this.assertBothEndpoints(member, sourceSiteId, targetSiteId);

    const updatePayload = this.conflictService.buildUpdatePayload(
      patch,
      CONNECTION_WRITABLE_FIELDS,
      connection.version,
      CreateConnectionDto,
    );

    const updated = await this.connectionsRepository.updateWithVersion(
      connectionId,
      organizationId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const dto = this.toDto(updated);
    await this.audit.recordUpdate(organizationId, 'DeviceConnection', connectionId, patch.changes);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.CONNECTION_UPDATED,
      { connectionId, connection: dto, changes: patch.changes, updatedBy: updated.userId ?? '' },
      organizationId,
    );
    return dto;
  }

  async deleteConnection(member: OrgMemberContext, connectionId: string): Promise<void> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup so out-of-scope ADMIN → PERM_001 not 404
    const connection = await this.connectionsRepository.findByIdAndOrgId(connectionId, organizationId);
    if (!connection) {
      throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const { sourceSiteId, targetSiteId } = await this.resolveEndpointSites(
      organizationId,
      connection.sourceDeviceId,
      connection.targetDeviceId,
    );
    await this.assertBothEndpoints(member, sourceSiteId, targetSiteId);

    await this.connectionsRepository.deleteByIdAndOrgId(connectionId, organizationId);
    await this.audit.recordDelete(organizationId, 'DeviceConnection', connection);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.CONNECTION_DELETED,
      { connectionId },
      organizationId,
    );
  }

  /** Load both endpoint devices (throws DEVICE_001 if either missing) and return their siteIds. */
  private async resolveEndpointSites(
    organizationId: string,
    sourceDeviceId: string,
    targetDeviceId: string,
  ): Promise<{ sourceSiteId: string; targetSiteId: string }> {
    const [source, target] = await Promise.all([
      this.devicesRepository.findByIdAndOrgId(sourceDeviceId, organizationId),
      this.devicesRepository.findByIdAndOrgId(targetDeviceId, organizationId),
    ]);
    if (!source || !target) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return { sourceSiteId: (source as Device).propertyId, targetSiteId: (target as Device).propertyId };
  }

  /** Assert write access to both endpoint sites. MEMBER → ORG_003; ADMIN missing either → PERM_001. */
  private async assertBothEndpoints(
    member: OrgMemberContext,
    sourceSiteId: string,
    targetSiteId: string,
  ): Promise<void> {
    await this.permissions.assertCanConfigure(member, sourceSiteId);
    await this.permissions.assertCanConfigure(member, targetSiteId);
  }

  private toDto(connection: DeviceConnection): DeviceConnectionDto {
    return {
      id: connection.id,
      userId: connection.userId,
      sourceDeviceId: connection.sourceDeviceId,
      targetDeviceId: connection.targetDeviceId,
      connectionType: connection.connectionType as DeviceConnectionDto['connectionType'],
      notes: connection.notes,
      version: connection.version,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    };
  }
}
