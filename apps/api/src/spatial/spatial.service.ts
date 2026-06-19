import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceDto, DevicePositionDto, WS_EVENTS } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { toDeviceDto } from '../devices/device.mapper';
import { BuildingModelsRepository } from '../building-models/building-models.repository';
import { PermissionsService } from '../permissions/permissions.service';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { SpatialRepository } from './spatial.repository';

/**
 * Business logic for device 3D positioning (Spec 1 Phase C).
 * Rules enforced here:
 *   SPATIAL_001 — device must be under a property with an active building model.
 *   SPATIAL_002 — x/y/z must all be set or all null (no partial triples).
 * DB access is delegated to SpatialRepository (Rule #2).
 */
@Injectable()
export class SpatialService {
  constructor(
    private readonly repo: SpatialRepository,
    private readonly models: BuildingModelsRepository,
    private readonly permissions: PermissionsService,
    private readonly conflict: ConflictResolutionService,
  ) {}

  async setPosition(
    member: OrgMemberContext,
    deviceId: string,
    pos: DevicePositionDto,
  ): Promise<DeviceDto> {
    const device = await this.repo.findDevice(member.organizationId, deviceId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // F3 / Spec 4 §8: per-site configure scope — OWNER any; MEMBER → ORG_003; out-of-scope ADMIN → PERM_001.
    // (Authorize against the device's current governing site; org-wide lookup above so out-of-scope ADMIN → 403 not 404.)
    await this.permissions.assertCanConfigure(member, device.propertyId);

    // Loose `== null` is intentional: a field absent from the request body arrives as undefined,
    // and both undefined and null must count as "unset".
    const allNull = pos.x == null && pos.y == null && pos.z == null;
    const allSet = pos.x != null && pos.y != null && pos.z != null;
    if (!allNull && !allSet) {
      throw new NodeScopeException(
        'SPATIAL_002',
        'INCOMPLETE_POSITION',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (allSet) {
      const buildingPropertyId = await this.repo.resolveGoverningBuildingId(
        member.organizationId,
        device.propertyId,
      );
      const model = buildingPropertyId
        ? await this.models.findByProperty(member.organizationId, buildingPropertyId)
        : null;
      if (!model) {
        throw new NodeScopeException(
          'SPATIAL_001',
          'DEVICE_NOT_IN_MODELED_BUILDING',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    const updated = await this.repo.setPosition(
      member.organizationId,
      deviceId,
      pos.x,
      pos.y,
      pos.z,
    );
    if (!updated) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const dto = toDeviceDto(updated);
    // Spec 4 §10: position changes propagate live (carries x/y/z) — scoped to the device's site (F3).
    const changes = (['x', 'y', 'z'] as const)
      .filter((f) => device[f] !== updated[f])
      .map((f) => ({ field: f, oldValue: device[f], newValue: updated[f] }));
    await this.conflict.emitScoped(member.organizationId, updated.propertyId, WS_EVENTS.DEVICE_UPDATED, {
      deviceId,
      device: dto,
      changes,
      updatedBy: updated.userId ?? '',
    });
    return dto;
  }
}
