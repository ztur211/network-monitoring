import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { FiberRun } from '@prisma/client';
import { FiberRunDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { DevicesRepository } from '../devices/devices.repository';
import { CreateFiberRunDto, FIBER_RUN_WRITABLE_FIELDS, PatchFiberRunDto } from './fiber-runs.dto';
import { FiberRunsRepository } from './fiber-runs.repository';

@Injectable()
export class FiberRunsService {
  constructor(
    private readonly fiberRunsRepository: FiberRunsRepository,
    private readonly devicesRepository: DevicesRepository,
    private readonly conflictService: ConflictResolutionService,
    private readonly audit: AuditService,
  ) {}

  async listFiberRuns(organizationId: string, deviceId?: string): Promise<PaginatedResponse<FiberRunDto>> {
    // `deviceId` is a raw query param; a malformed value (e.g. the array Express
    // parses from `?deviceId[]=a&deviceId[]=b`) would otherwise reach Prisma as an
    // invalid scalar filter and 500. A bad filter is client input → 400.
    if (deviceId !== undefined && !isUUID(deviceId)) {
      throw new NodeScopeException('GEN_001', 'INVALID_DEVICE_ID', HttpStatus.BAD_REQUEST);
    }
    const [items, total] = await Promise.all([
      this.fiberRunsRepository.findAllByOrgId(organizationId, deviceId),
      this.fiberRunsRepository.countByOrgId(organizationId),
    ]);
    return { items: items.map((r) => this.toDto(r)), total };
  }

  async createFiberRun(
    organizationId: string,
    creatorUserId: string,
    dto: CreateFiberRunDto,
  ): Promise<FiberRunDto> {
    if (dto.startDeviceId === dto.endDeviceId) {
      throw new NodeScopeException('FIBER_002', 'FIBER_RUN_SAME_DEVICE', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const [startDevice, endDevice] = await Promise.all([
      this.devicesRepository.findByIdAndOrgId(dto.startDeviceId, organizationId),
      this.devicesRepository.findByIdAndOrgId(dto.endDeviceId, organizationId),
    ]);

    if (!startDevice || !endDevice) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const run = await this.fiberRunsRepository.create({
      organizationId,
      userId: creatorUserId,
      ...dto,
    });
    await this.audit.recordCreate(organizationId, 'FiberRun', run);
    return this.toDto(run);
  }

  async getFiberRun(organizationId: string, fiberRunId: string): Promise<FiberRunDto> {
    const run = await this.fiberRunsRepository.findByIdAndOrgId(fiberRunId, organizationId);
    if (!run) {
      throw new NodeScopeException('FIBER_001', 'FIBER_RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(run);
  }

  async updateFiberRun(
    organizationId: string,
    fiberRunId: string,
    patch: PatchFiberRunDto,
  ): Promise<FiberRunDto> {
    const run = await this.fiberRunsRepository.findByIdAndOrgId(fiberRunId, organizationId);
    if (!run) {
      throw new NodeScopeException('FIBER_001', 'FIBER_RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const updatePayload = this.conflictService.buildUpdatePayload(
      patch,
      FIBER_RUN_WRITABLE_FIELDS,
      run.version,
      CreateFiberRunDto,
    );

    const updated = await this.fiberRunsRepository.updateWithVersion(
      fiberRunId,
      organizationId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const dto = this.toDto(updated);
    await this.audit.recordUpdate(organizationId, 'FiberRun', fiberRunId, patch.changes);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.FIBER_RUN_UPDATED,
      { fiberRunId, fiberRun: dto, changes: patch.changes, updatedBy: updated.userId ?? '' },
      organizationId,
    );
    return dto;
  }

  async deleteFiberRun(organizationId: string, fiberRunId: string): Promise<void> {
    const run = await this.fiberRunsRepository.findByIdAndOrgId(fiberRunId, organizationId);
    if (!run) {
      throw new NodeScopeException('FIBER_001', 'FIBER_RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.fiberRunsRepository.deleteByIdAndOrgId(fiberRunId, organizationId);
    await this.audit.recordDelete(organizationId, 'FiberRun', run);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.FIBER_RUN_DELETED,
      { fiberRunId },
      organizationId,
    );
  }

  private toDto(run: FiberRun): FiberRunDto {
    return {
      id: run.id,
      userId: run.userId,
      name: run.name,
      startDeviceId: run.startDeviceId,
      endDeviceId: run.endDeviceId,
      cableType: run.cableType,
      lengthMeters: run.lengthMeters,
      notes: run.notes,
      version: run.version,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }
}
