import { HttpStatus, Injectable } from '@nestjs/common';
import { FiberRun } from '@prisma/client';
import { FiberRunDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
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
  ) {}

  async listFiberRuns(userId: string, deviceId?: string): Promise<PaginatedResponse<FiberRunDto>> {
    const [items, total] = await Promise.all([
      this.fiberRunsRepository.findAllByUserId(userId, deviceId),
      this.fiberRunsRepository.countByUserId(userId),
    ]);
    return { items: items.map((r) => this.toDto(r)), total };
  }

  async createFiberRun(userId: string, dto: CreateFiberRunDto): Promise<FiberRunDto> {
    if (dto.startDeviceId === dto.endDeviceId) {
      throw new NodeScopeException('FIBER_002', 'FIBER_RUN_SAME_DEVICE', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const [startDevice, endDevice] = await Promise.all([
      this.devicesRepository.findByIdAndUserId(dto.startDeviceId, userId),
      this.devicesRepository.findByIdAndUserId(dto.endDeviceId, userId),
    ]);

    if (!startDevice || !endDevice) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const run = await this.fiberRunsRepository.create({ userId, ...dto });
    return this.toDto(run);
  }

  async getFiberRun(userId: string, fiberRunId: string): Promise<FiberRunDto> {
    const run = await this.fiberRunsRepository.findByIdAndUserId(fiberRunId, userId);
    if (!run) {
      throw new NodeScopeException('FIBER_001', 'FIBER_RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(run);
  }

  async updateFiberRun(userId: string, fiberRunId: string, patch: PatchFiberRunDto): Promise<FiberRunDto> {
    const run = await this.fiberRunsRepository.findByIdAndUserId(fiberRunId, userId);
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
      userId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const dto = this.toDto(updated);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.FIBER_RUN_UPDATED,
      { fiberRunId, fiberRun: dto, changes: patch.changes, updatedBy: userId },
      userId,
    );
    return dto;
  }

  async deleteFiberRun(userId: string, fiberRunId: string): Promise<void> {
    const run = await this.fiberRunsRepository.findByIdAndUserId(fiberRunId, userId);
    if (!run) {
      throw new NodeScopeException('FIBER_001', 'FIBER_RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.fiberRunsRepository.deleteByIdAndUserId(fiberRunId, userId);
    this.conflictService.emitEntityEvent(WS_EVENTS.FIBER_RUN_DELETED, { fiberRunId }, userId);
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
