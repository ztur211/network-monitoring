import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DeviceConnection } from '@prisma/client';
import { DeviceConnectionDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { DevicesRepository } from '../devices/devices.repository';
import { CONNECTION_WRITABLE_FIELDS, CreateConnectionDto, PatchConnectionDto } from './connections.dto';
import { ConnectionsRepository } from './connections.repository';

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly connectionsRepository: ConnectionsRepository,
    private readonly devicesRepository: DevicesRepository,
    private readonly conflictService: ConflictResolutionService,
  ) {}

  async listConnections(organizationId: string, deviceId?: string): Promise<PaginatedResponse<DeviceConnectionDto>> {
    // `deviceId` is a raw query param; a malformed value (e.g. the array Express
    // parses from `?deviceId[]=a&deviceId[]=b`) would otherwise reach Prisma as an
    // invalid scalar filter and 500. A bad filter is client input → 400.
    if (deviceId !== undefined && !isUUID(deviceId)) {
      throw new NodeScopeException('GEN_001', 'INVALID_DEVICE_ID', HttpStatus.BAD_REQUEST);
    }
    const [items, total] = await Promise.all([
      this.connectionsRepository.findAllByOrgId(organizationId, deviceId),
      this.connectionsRepository.countByOrgId(organizationId),
    ]);
    return { items: items.map((c) => this.toDto(c)), total };
  }

  async createConnection(
    organizationId: string,
    creatorUserId: string,
    dto: CreateConnectionDto,
  ): Promise<DeviceConnectionDto> {
    if (dto.sourceDeviceId === dto.targetDeviceId) {
      throw new NodeScopeException('CONN_002', 'SELF_CONNECTION', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const [source, target] = await Promise.all([
      this.devicesRepository.findByIdAndOrgId(dto.sourceDeviceId, organizationId),
      this.devicesRepository.findByIdAndOrgId(dto.targetDeviceId, organizationId),
    ]);
    if (!source || !target) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

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
    return this.toDto(connection);
  }

  async getConnection(organizationId: string, connectionId: string): Promise<DeviceConnectionDto> {
    const connection = await this.connectionsRepository.findByIdAndOrgId(connectionId, organizationId);
    if (!connection) {
      throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(connection);
  }

  async updateConnection(
    organizationId: string,
    connectionId: string,
    patch: PatchConnectionDto,
  ): Promise<DeviceConnectionDto> {
    const connection = await this.connectionsRepository.findByIdAndOrgId(connectionId, organizationId);
    if (!connection) {
      throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

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
    this.conflictService.emitEntityEvent(
      WS_EVENTS.CONNECTION_UPDATED,
      { connectionId, connection: dto, changes: patch.changes, updatedBy: updated.userId ?? '' },
      updated.userId ?? '',
    );
    return dto;
  }

  async deleteConnection(organizationId: string, connectionId: string): Promise<void> {
    const connection = await this.connectionsRepository.findByIdAndOrgId(connectionId, organizationId);
    if (!connection) {
      throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.connectionsRepository.deleteByIdAndOrgId(connectionId, organizationId);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.CONNECTION_DELETED,
      { connectionId },
      connection.userId ?? '',
    );
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
