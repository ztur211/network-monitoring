import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { toDeviceDto } from './device.mapper';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import type { OrgMemberContext } from '../organizations/org-context.types';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { assertNameMatchesPolicy } from '../organizations/naming-policy';
import { PermissionsService } from '../permissions/permissions.service';
import { ContainmentService } from '../properties/containment.service';
import { PropertiesService } from '../properties/properties.service';
import { SpatialRepository } from '../spatial/spatial.repository';
import { CreateDeviceDto, DEVICE_WRITABLE_FIELDS, PatchDeviceDto } from './devices.dto';
import { DevicesRepository } from './devices.repository';

@Injectable()
export class DevicesService {
  constructor(
    private readonly devicesRepository: DevicesRepository,
    private readonly conflictService: ConflictResolutionService,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly audit: AuditService,
    private readonly containment: ContainmentService,
    private readonly permissions: PermissionsService,
    private readonly properties: PropertiesService,
    private readonly spatial: SpatialRepository,
  ) {}

  async listDevices(member: OrgMemberContext): Promise<PaginatedResponse<DeviceDto>> {
    const scope = await this.permissions.scopeFilter(member);
    const [items, total] = await Promise.all([
      this.devicesRepository.findAllByOrgId(member.organizationId, scope),
      this.devicesRepository.countByOrgId(member.organizationId, scope),
    ]);
    return { items: items.map((d) => toDeviceDto(d)), total };
  }

  /**
   * Spec 4: the active building's devices for the 3D viewport. Devices whose propertyId is at/under
   * the building (F2 subtree), AND-ed with the caller's F3 read-scope (null = OWNER, no filter).
   * Not paginated — a building's in-scope device set is loaded whole into the node layer.
   */
  async listDevicesForBuilding(
    member: OrgMemberContext,
    buildingPropertyId: string,
  ): Promise<DeviceDto[]> {
    const subtree = await this.properties.subtreePropertyIds(member.organizationId, buildingPropertyId);
    const scope = await this.permissions.scopeFilter(member);
    const propertyIdIn = scope ? subtree.filter((id) => scope.propertyIdIn.includes(id)) : subtree;
    if (propertyIdIn.length === 0) return [];
    const items = await this.devicesRepository.findAllByOrgId(member.organizationId, { propertyIdIn });
    return items.map((d) => toDeviceDto(d));
  }

  async createDevice(
    member: OrgMemberContext,
    creatorUserId: string,
    dto: CreateDeviceDto,
  ): Promise<DeviceDto> {
    await this.permissions.assertCanConfigure(member, dto.propertyId);
    const organizationId = member.organizationId;

    const org = await this.organizationsRepository.findOrganizationById(organizationId);
    if (!org) {
      throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const nameTaken = await this.devicesRepository.existsByNameCaseInsensitive(
      organizationId,
      dto.name,
    );
    if (nameTaken) {
      throw new NodeScopeException('ORG_005', 'DEVICE_NAME_TAKEN', HttpStatus.CONFLICT);
    }

    assertNameMatchesPolicy(dto.name, org);

    await this.containment.assertDevicePlacement(organizationId, dto.networkId, dto.propertyId);

    const device = await this.devicesRepository.create({
      organizationId,
      userId: creatorUserId,
      ...dto,
    });
    await this.audit.recordCreate(organizationId, 'Device', device);
    return toDeviceDto(device);
  }

  async getDevice(member: OrgMemberContext, deviceId: string): Promise<DeviceDto> {
    const scope = await this.permissions.scopeFilter(member);
    const device = await this.devicesRepository.findByIdAndOrgId(deviceId, member.organizationId, scope);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return toDeviceDto(device);
  }

  async updateDevice(
    member: OrgMemberContext,
    deviceId: string,
    patch: PatchDeviceDto,
  ): Promise<DeviceDto> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup (no scope) so out-of-scope ADMIN → PERM_001 not 404
    const device = await this.devicesRepository.findByIdAndOrgId(deviceId, organizationId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    // Authorize against the device's current governing site
    await this.permissions.assertCanConfigure(member, device.propertyId);

    // If patch moves the device to a new site, also assert access to the target site
    const nextPropertyId = (patch.changes.find((c) => c.field === 'propertyId')?.newValue as string) ?? device.propertyId;
    if (nextPropertyId !== device.propertyId) {
      await this.permissions.assertCanConfigure(member, nextPropertyId);
    }

    const updatePayload = this.conflictService.buildUpdatePayload(
      patch,
      DEVICE_WRITABLE_FIELDS,
      device.version,
      CreateDeviceDto,
    );

    if (updatePayload.name !== undefined) {
      const org = await this.organizationsRepository.findOrganizationById(organizationId);
      if (!org) {
        throw new NodeScopeException('ORG_001', 'ORGANIZATION_NOT_FOUND', HttpStatus.NOT_FOUND);
      }

      const nameTaken = await this.devicesRepository.existsByNameCaseInsensitive(
        organizationId,
        updatePayload.name as string,
        deviceId,
      );
      if (nameTaken) {
        throw new NodeScopeException('ORG_005', 'DEVICE_NAME_TAKEN', HttpStatus.CONFLICT);
      }

      assertNameMatchesPolicy(updatePayload.name as string, org);
    }

    // If patch changes networkId or propertyId, re-validate containment
    if (patch.changes.some((c) => c.field === 'propertyId' || c.field === 'networkId')) {
      const nextNetworkId = (patch.changes.find((c) => c.field === 'networkId')?.newValue as string) ?? device.networkId;
      await this.containment.assertDevicePlacement(organizationId, nextNetworkId, nextPropertyId);
    }

    // Spec 1 §6: model-local coords are tied to the device's governing building.
    // If a move changes the governing BUILDING, the old x/y/z no longer mean anything — clear them.
    if (nextPropertyId !== device.propertyId) {
      const [oldBuildingId, newBuildingId] = await Promise.all([
        this.spatial.resolveGoverningBuildingId(organizationId, device.propertyId),
        this.spatial.resolveGoverningBuildingId(organizationId, nextPropertyId),
      ]);
      if (oldBuildingId !== newBuildingId) {
        updatePayload.x = null;
        updatePayload.y = null;
        updatePayload.z = null;
      }
    }

    const updated = await this.devicesRepository.updateWithVersion(
      deviceId,
      organizationId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const dto = toDeviceDto(updated);
    await this.audit.recordUpdate(organizationId, 'Device', deviceId, patch.changes);
    await this.conflictService.emitScoped(
      member.organizationId,
      updated.propertyId,
      WS_EVENTS.DEVICE_UPDATED,
      { deviceId, device: dto, changes: patch.changes, updatedBy: updated.userId ?? '' },
    );
    return dto;
  }

  async deleteDevice(member: OrgMemberContext, deviceId: string): Promise<void> {
    const organizationId = member.organizationId;
    // Write path: org-wide lookup (no scope) so out-of-scope ADMIN → PERM_001 not 404
    const device = await this.devicesRepository.findByIdAndOrgId(deviceId, organizationId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.permissions.assertCanConfigure(member, device.propertyId);
    await this.devicesRepository.deleteByIdAndOrgId(deviceId, organizationId);
    await this.audit.recordDelete(organizationId, 'Device', device);
    await this.conflictService.emitScoped(
      member.organizationId,
      device.propertyId,
      WS_EVENTS.DEVICE_DELETED,
      { deviceId },
    );
  }

}
