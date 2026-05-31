import { HttpStatus, Injectable } from '@nestjs/common';
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

  async listConnections(userId: string, deviceId?: string): Promise<PaginatedResponse<DeviceConnectionDto>> {
    const [items, total] = await Promise.all([
      this.connectionsRepository.findAllByUserId(userId, deviceId),
      this.connectionsRepository.countByUserId(userId),
    ]);
    return { items: items.map((c) => this.toDto(c)), total };
  }

  async createConnection(userId: string, dto: CreateConnectionDto): Promise<DeviceConnectionDto> {
    if (dto.sourceDeviceId === dto.targetDeviceId) {
      throw new NodeScopeException('CONN_002', 'SELF_CONNECTION', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const [source, target] = await Promise.all([
      this.devicesRepository.findByIdAndUserId(dto.sourceDeviceId, userId),
      this.devicesRepository.findByIdAndUserId(dto.targetDeviceId, userId),
    ]);
    if (!source || !target) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const duplicate = await this.connectionsRepository.existsDuplicate(
      userId,
      dto.sourceDeviceId,
      dto.targetDeviceId,
      dto.connectionType,
    );
    if (duplicate) {
      throw new NodeScopeException('CONN_003', 'DUPLICATE_CONNECTION', HttpStatus.CONFLICT);
    }

    const connection = await this.connectionsRepository.create({ userId, ...dto });
    return this.toDto(connection);
  }

  async getConnection(userId: string, connectionId: string): Promise<DeviceConnectionDto> {
    const connection = await this.connectionsRepository.findByIdAndUserId(connectionId, userId);
    if (!connection) {
      throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(connection);
  }

  async updateConnection(
    userId: string,
    connectionId: string,
    patch: PatchConnectionDto,
  ): Promise<DeviceConnectionDto> {
    const connection = await this.connectionsRepository.findByIdAndUserId(connectionId, userId);
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
      userId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const dto = this.toDto(updated);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.CONNECTION_UPDATED,
      { connectionId, connection: dto, changes: patch.changes, updatedBy: userId },
      userId,
    );
    return dto;
  }

  async deleteConnection(userId: string, connectionId: string): Promise<void> {
    const connection = await this.connectionsRepository.findByIdAndUserId(connectionId, userId);
    if (!connection) {
      throw new NodeScopeException('CONN_001', 'CONNECTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.connectionsRepository.deleteByIdAndUserId(connectionId, userId);
    this.conflictService.emitEntityEvent(WS_EVENTS.CONNECTION_DELETED, { connectionId }, userId);
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
