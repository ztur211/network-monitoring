import { HttpStatus, Injectable } from '@nestjs/common';
import { Device, DeviceCategory, DeviceMobility } from '@prisma/client';
import { DeviceDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { AuditService } from '../audit/audit.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { assertNameMatchesPolicy } from '../organizations/naming-policy';
import { CreateDeviceDto, DEVICE_WRITABLE_FIELDS, PatchDeviceDto } from './devices.dto';
import { DevicesRepository } from './devices.repository';

@Injectable()
export class DevicesService {
  constructor(
    private readonly devicesRepository: DevicesRepository,
    private readonly conflictService: ConflictResolutionService,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly audit: AuditService,
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

  async findDeviceIdByBrowserDeviceId(
    organizationId: string,
    browserDeviceId: string,
  ): Promise<string | null> {
    const device = await this.devicesRepository.findByOrgIdAndBrowserDeviceId(
      organizationId,
      browserDeviceId,
    );
    return device?.id ?? null;
  }

  /**
   * Idempotent create-or-fetch for a BROWSER_CLIENT device tied to a
   * specific browser via its localStorage-bound `browserDeviceId`. If a row
   * already exists for this (organizationId, browserDeviceId) the existing row
   * is returned unchanged — a browser refresh during onboarding must not
   * create duplicates or fail on the unique constraint.
   *
   * Does not apply the tier device-limit — a browser device should not consume
   * a device slot. Naming policy (length + regex) still applies.
   *
   * NOTE: callers must already have resolved an organizationId for the user.
   * For fresh users who have not yet joined an org (e.g. the onboarding wizard
   * prior to org creation), the calling service is responsible for creating the
   * org first and supplying its id here.
   */
  async createBrowserDevice(
    organizationId: string,
    creatorUserId: string,
    browserDeviceId: string,
    name: string,
    mobility: DeviceMobility,
    networkId?: string,
  ): Promise<DeviceDto> {
    const existing = await this.devicesRepository.findByOrgIdAndBrowserDeviceId(
      organizationId,
      browserDeviceId,
    );
    if (existing) return this.toDto(existing);

    const nameTaken = await this.devicesRepository.existsByNameCaseInsensitive(
      organizationId,
      name,
    );
    if (nameTaken) {
      throw new NodeScopeException('ORG_005', 'DEVICE_NAME_TAKEN', HttpStatus.CONFLICT);
    }

    const device = await this.devicesRepository.create({
      organizationId,
      userId: creatorUserId,
      name,
      category: DeviceCategory.BROWSER_CLIENT,
      mobility,
      browserDeviceId,
      networkId,
    });
    await this.audit.recordCreate(organizationId, 'Device', device);
    const dto = this.toDto(device);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.DEVICE_UPDATED,
      { deviceId: device.id, device: dto, updatedBy: creatorUserId },
      organizationId,
    );
    return dto;
  }

  private toDto(device: Device): DeviceDto {
    return {
      id: device.id,
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
      browserDeviceId: device.browserDeviceId,
      version: device.version,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    };
  }
}
