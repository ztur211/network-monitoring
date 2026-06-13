import { HttpStatus, Injectable } from '@nestjs/common';
import { Device } from '@prisma/client';
import { DeviceDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { assertNameMatchesPolicy } from '../organizations/naming-policy';
import { ContainmentService } from '../properties/containment.service';
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
  ) {}

  async listDevices(organizationId: string): Promise<PaginatedResponse<DeviceDto>> {
    const [items, total] = await Promise.all([
      this.devicesRepository.findAllByOrgId(organizationId),
      this.devicesRepository.countByOrgId(organizationId),
    ]);
    return { items: items.map((d) => this.toDto(d)), total };
  }

  async createDevice(
    organizationId: string,
    creatorUserId: string,
    dto: CreateDeviceDto,
  ): Promise<DeviceDto> {
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
    return this.toDto(device);
  }

  async getDevice(organizationId: string, deviceId: string): Promise<DeviceDto> {
    const device = await this.devicesRepository.findByIdAndOrgId(deviceId, organizationId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(device);
  }

  async updateDevice(
    organizationId: string,
    deviceId: string,
    patch: PatchDeviceDto,
  ): Promise<DeviceDto> {
    const device = await this.devicesRepository.findByIdAndOrgId(deviceId, organizationId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
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
      const nextPropertyId = (patch.changes.find((c) => c.field === 'propertyId')?.newValue as string) ?? device.propertyId;
      await this.containment.assertDevicePlacement(organizationId, nextNetworkId, nextPropertyId);
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

    const dto = this.toDto(updated);
    await this.audit.recordUpdate(organizationId, 'Device', deviceId, patch.changes);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.DEVICE_UPDATED,
      { deviceId, device: dto, changes: patch.changes, updatedBy: updated.userId ?? '' },
      organizationId,
    );
    return dto;
  }

  async deleteDevice(organizationId: string, deviceId: string): Promise<void> {
    const device = await this.devicesRepository.findByIdAndOrgId(deviceId, organizationId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.devicesRepository.deleteByIdAndOrgId(deviceId, organizationId);
    await this.audit.recordDelete(organizationId, 'Device', device);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.DEVICE_DELETED,
      { deviceId },
      organizationId,
    );
  }

  private toDto(device: Device): DeviceDto {
    return {
      id: device.id,
      networkId: device.networkId,
      propertyId: device.propertyId,
      roleCode: device.roleCode,
      userId: device.userId,
      name: device.name,
      category: device.category,
      latitude: device.latitude,
      longitude: device.longitude,
      floor: device.floor,
      floorLabel: device.floorLabel,
      ipAddress: device.ipAddress,
      macAddress: device.macAddress,
      notes: device.notes,
      version: device.version,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    };
  }
}
