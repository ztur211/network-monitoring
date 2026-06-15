import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceDto, DevicePositionDto } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { toDeviceDto } from '../devices/device.mapper';
import { BuildingModelsRepository } from '../building-models/building-models.repository';
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
    return toDeviceDto(updated);
  }
}
