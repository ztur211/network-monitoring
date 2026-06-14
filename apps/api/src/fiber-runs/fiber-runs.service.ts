import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Device, FiberRun } from '@prisma/client';
import { FiberRunDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { DevicesRepository } from '../devices/devices.repository';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { PermissionsService } from '../permissions/permissions.service';
import { CreateFiberRunDto, FIBER_RUN_WRITABLE_FIELDS, PatchFiberRunDto } from './fiber-runs.dto';
import { FiberRunsRepository } from './fiber-runs.repository';

@Injectable()
export class FiberRunsService {
  constructor(
    private readonly fiberRunsRepository: FiberRunsRepository,
    private readonly devicesRepository: DevicesRepository,
    private readonly conflictService: ConflictResolutionService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async listFiberRuns(member: OrgMemberContext, deviceId?: string): Promise<PaginatedResponse<FiberRunDto>> {
    // `deviceId` is a raw query param; a malformed value (e.g. the array Express
    // parses from `?deviceId[]=a&deviceId[]=b`) would otherwise reach Prisma as an
    // invalid scalar filter and 500. A bad filter is client input → 400.
    if (deviceId !== undefined && !isUUID(deviceId)) {
      throw new NodeScopeException('GEN_001', 'INVALID_DEVICE_ID', HttpStatus.BAD_REQUEST);
    }
    const scope = await this.permissions.scopeFilter(member);
    const items = await this.fiberRunsRepository.listVisible(member.organizationId, scope, deviceId);
    return { items: items.map((r) => this.toDto(r)), total: items.length };
  }

  async createFiberRun(
    member: OrgMemberContext,
    creatorUserId: string,
    dto: CreateFiberRunDto,
  ): Promise<FiberRunDto> {
    const organizationId = member.organizationId;

    if (dto.startDeviceId === dto.endDeviceId) {
      throw new NodeScopeException('FIBER_002', 'FIBER_RUN_SAME_DEVICE', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const { startSiteId, endSiteId } = await this.resolveEndpointSites(
      organizationId,
      dto.startDeviceId,
      dto.endDeviceId,
    );
    await this.assertBothEndpoints(member, startSiteId, endSiteId);

    const run = await this.fiberRunsRepository.create({
      organizationId,
      userId: creatorUserId,
      ...dto,
    });
    await this.audit.recordCreate(organizationId, 'FiberRun', run);
    return this.toDto(run);
  }

  async getFiberRun(member: OrgMemberContext, fiberRunId: string): Promise<FiberRunDto> {
    const scope = await this.permissions.scopeFilter(member);
    const run = await this.fiberRunsRepository.findVisibleByIdAndOrgId(fiberRunId, member.organizationId, scope);
    if (!run) {
      throw new NodeScopeException('FIBER_001', 'FIBER_RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(run);
  }

  async updateFiberRun(
    member: OrgMemberContext,
    fiberRunId: string,
    patch: PatchFiberRunDto,
  ): Promise<FiberRunDto> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup so out-of-scope ADMIN → PERM_001 not 404
    const run = await this.fiberRunsRepository.findByIdAndOrgId(fiberRunId, organizationId);
    if (!run) {
      throw new NodeScopeException('FIBER_001', 'FIBER_RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const { startSiteId, endSiteId } = await this.resolveEndpointSites(
      organizationId,
      run.startDeviceId,
      run.endDeviceId,
    );
    await this.assertBothEndpoints(member, startSiteId, endSiteId);

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

  async deleteFiberRun(member: OrgMemberContext, fiberRunId: string): Promise<void> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup so out-of-scope ADMIN → PERM_001 not 404
    const run = await this.fiberRunsRepository.findByIdAndOrgId(fiberRunId, organizationId);
    if (!run) {
      throw new NodeScopeException('FIBER_001', 'FIBER_RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const { startSiteId, endSiteId } = await this.resolveEndpointSites(
      organizationId,
      run.startDeviceId,
      run.endDeviceId,
    );
    await this.assertBothEndpoints(member, startSiteId, endSiteId);

    await this.fiberRunsRepository.deleteByIdAndOrgId(fiberRunId, organizationId);
    await this.audit.recordDelete(organizationId, 'FiberRun', run);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.FIBER_RUN_DELETED,
      { fiberRunId },
      organizationId,
    );
  }

  /** Load both endpoint devices (throws DEVICE_001 if either missing) and return their siteIds. */
  private async resolveEndpointSites(
    organizationId: string,
    startDeviceId: string,
    endDeviceId: string,
  ): Promise<{ startSiteId: string; endSiteId: string }> {
    const [startDevice, endDevice] = await Promise.all([
      this.devicesRepository.findByIdAndOrgId(startDeviceId, organizationId),
      this.devicesRepository.findByIdAndOrgId(endDeviceId, organizationId),
    ]);
    if (!startDevice || !endDevice) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return {
      startSiteId: (startDevice as Device).propertyId,
      endSiteId: (endDevice as Device).propertyId,
    };
  }

  /** Assert write access to both endpoint sites. MEMBER → ORG_003; ADMIN missing either → PERM_001. */
  private async assertBothEndpoints(
    member: OrgMemberContext,
    startSiteId: string,
    endSiteId: string,
  ): Promise<void> {
    await this.permissions.assertCanConfigure(member, startSiteId);
    await this.permissions.assertCanConfigure(member, endSiteId);
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
