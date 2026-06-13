import { HttpStatus, Injectable } from '@nestjs/common';
import { Circuit } from '@prisma/client';
import { CircuitDto, CursorPaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { DevicesRepository } from '../devices/devices.repository';
import { CIRCUIT_WRITABLE_FIELDS, CreateCircuitDto, ListCircuitsQueryDto, PatchCircuitDto } from './circuits.dto';
import { CircuitsRepository } from './circuits.repository';

const DEFAULT_LIMIT = 50;

@Injectable()
export class CircuitsService {
  constructor(
    private readonly circuitsRepository: CircuitsRepository,
    private readonly devicesRepository: DevicesRepository,
    private readonly conflictService: ConflictResolutionService,
    private readonly audit: AuditService,
  ) {}

  async listCircuits(organizationId: string, query: ListCircuitsQueryDto): Promise<CursorPaginatedResponse<CircuitDto>> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const [items, total] = await Promise.all([
      this.circuitsRepository.findWithCursor(organizationId, limit + 1, query.cursor),
      this.circuitsRepository.countByOrgId(organizationId),
    ]);

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            createdAt: page[page.length - 1].createdAt.toISOString(),
            id: page[page.length - 1].id,
          }),
        ).toString('base64')
      : null;

    return { items: page.map((c) => this.toDto(c)), nextCursor, total };
  }

  async createCircuit(
    organizationId: string,
    creatorUserId: string,
    dto: CreateCircuitDto,
  ): Promise<CircuitDto> {
    if (dto.deviceId) {
      const device = await this.devicesRepository.findByIdAndOrgId(dto.deviceId, organizationId);
      if (!device) {
        throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
    }

    const circuit = await this.circuitsRepository.create({
      organizationId,
      userId: creatorUserId,
      ...dto,
    });
    await this.audit.recordCreate(organizationId, 'Circuit', circuit);
    return this.toDto(circuit);
  }

  async getCircuit(organizationId: string, circuitId: string): Promise<CircuitDto> {
    const circuit = await this.circuitsRepository.findByIdAndOrgId(circuitId, organizationId);
    if (!circuit) {
      throw new NodeScopeException('CIRCUIT_001', 'CIRCUIT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(circuit);
  }

  async updateCircuit(
    organizationId: string,
    circuitId: string,
    patch: PatchCircuitDto,
  ): Promise<CircuitDto> {
    const circuit = await this.circuitsRepository.findByIdAndOrgId(circuitId, organizationId);
    if (!circuit) {
      throw new NodeScopeException('CIRCUIT_001', 'CIRCUIT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const updatePayload = this.conflictService.buildUpdatePayload(
      patch,
      CIRCUIT_WRITABLE_FIELDS,
      circuit.version,
      CreateCircuitDto,
    );

    if (updatePayload.deviceId !== undefined && updatePayload.deviceId !== null) {
      const device = await this.devicesRepository.findByIdAndOrgId(
        updatePayload.deviceId as string,
        organizationId,
      );
      if (!device) {
        throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
    }

    const updated = await this.circuitsRepository.updateWithVersion(
      circuitId,
      organizationId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const dto = this.toDto(updated);
    await this.audit.recordUpdate(organizationId, 'Circuit', circuitId, patch.changes);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.CIRCUIT_UPDATED,
      { circuitId, circuit: dto, changes: patch.changes, updatedBy: updated.userId ?? '' },
      updated.userId ?? '',
    );
    return dto;
  }

  async deleteCircuit(organizationId: string, circuitId: string): Promise<void> {
    const circuit = await this.circuitsRepository.findByIdAndOrgId(circuitId, organizationId);
    if (!circuit) {
      throw new NodeScopeException('CIRCUIT_001', 'CIRCUIT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.circuitsRepository.deleteByIdAndOrgId(circuitId, organizationId);
    await this.audit.recordDelete(organizationId, 'Circuit', circuit);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.CIRCUIT_DELETED,
      { circuitId },
      circuit.userId ?? '',
    );
  }

  private toDto(circuit: Circuit): CircuitDto {
    return {
      id: circuit.id,
      userId: circuit.userId,
      ispName: circuit.ispName,
      circuitId: circuit.circuitId,
      serviceType: circuit.serviceType,
      bandwidth: circuit.bandwidth,
      deviceId: circuit.deviceId,
      notes: circuit.notes,
      version: circuit.version,
      createdAt: circuit.createdAt.toISOString(),
      updatedAt: circuit.updatedAt.toISOString(),
    };
  }
}
