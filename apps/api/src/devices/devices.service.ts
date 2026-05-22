import { HttpStatus, Injectable } from '@nestjs/common';
import { Device, DeviceCategory, DeviceMobility } from '@prisma/client';
import { DeviceDto, PaginatedResponse, WS_EVENTS } from '@nodescope/shared';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { ConflictResolutionService } from '../conflict/conflict.service';
import { TiersService } from '../tiers/tiers.service';
import { CreateDeviceDto, DEVICE_WRITABLE_FIELDS, PatchDeviceDto } from './devices.dto';
import { DevicesRepository } from './devices.repository';

@Injectable()
export class DevicesService {
  constructor(
    private readonly devicesRepository: DevicesRepository,
    private readonly tiersService: TiersService,
    private readonly conflictService: ConflictResolutionService,
  ) {}

  async listDevices(userId: string): Promise<PaginatedResponse<DeviceDto>> {
    const [items, total] = await Promise.all([
      this.devicesRepository.findAllByUserId(userId),
      this.devicesRepository.countByUserId(userId),
    ]);
    return { items: items.map((d) => this.toDto(d)), total };
  }

  async createDevice(userId: string, userTier: string, dto: CreateDeviceDto): Promise<DeviceDto> {
    const limit = this.tiersService.getDeviceLimit(userTier);
    const count = await this.devicesRepository.countByUserId(userId);
    if (count >= limit) {
      throw new NodeScopeException('DEVICE_002', 'DEVICE_LIMIT_REACHED', HttpStatus.FORBIDDEN);
    }

    const nameTaken = await this.devicesRepository.existsByNameCaseInsensitive(userId, dto.name);
    if (nameTaken) {
      throw new NodeScopeException('DEVICE_003', 'DEVICE_NAME_TAKEN', HttpStatus.CONFLICT);
    }

    const device = await this.devicesRepository.create({ userId, ...dto });
    return this.toDto(device);
  }

  async getDevice(userId: string, deviceId: string): Promise<DeviceDto> {
    const device = await this.devicesRepository.findByIdAndUserId(deviceId, userId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return this.toDto(device);
  }

  async updateDevice(userId: string, deviceId: string, patch: PatchDeviceDto): Promise<DeviceDto> {
    const device = await this.devicesRepository.findByIdAndUserId(deviceId, userId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const updatePayload = this.conflictService.buildUpdatePayload(patch, DEVICE_WRITABLE_FIELDS, device.version);

    if (updatePayload.name !== undefined) {
      const nameTaken = await this.devicesRepository.existsByNameCaseInsensitive(
        userId,
        updatePayload.name as string,
        deviceId,
      );
      if (nameTaken) {
        throw new NodeScopeException('DEVICE_003', 'DEVICE_NAME_TAKEN', HttpStatus.CONFLICT);
      }
    }

    const updated = await this.devicesRepository.updateWithVersion(
      deviceId,
      userId,
      updatePayload,
      patch.baseVersion,
    );
    if (!updated) {
      throw new NodeScopeException('SYNC_001', 'EDIT_CONFLICT', HttpStatus.CONFLICT);
    }

    const dto = this.toDto(updated);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.DEVICE_UPDATED,
      { deviceId, device: dto, changes: patch.changes, updatedBy: userId },
      userId,
    );
    return dto;
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.devicesRepository.findByIdAndUserId(deviceId, userId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.devicesRepository.deleteByIdAndUserId(deviceId, userId);
    this.conflictService.emitEntityEvent(WS_EVENTS.DEVICE_DELETED, { deviceId }, userId);
  }

  async findDeviceIdByBrowserDeviceId(
    userId: string,
    browserDeviceId: string,
  ): Promise<string | null> {
    const device = await this.devicesRepository.findByUserIdAndBrowserDeviceId(
      userId,
      browserDeviceId,
    );
    return device?.id ?? null;
  }

  /**
   * Idempotent create-or-fetch for a BROWSER_CLIENT device tied to a
   * specific browser via its localStorage-bound `browserDeviceId`. If a row
   * already exists for this (userId, browserDeviceId) the existing row is
   * returned unchanged — a browser refresh during onboarding must not
   * create duplicates or fail on the unique constraint.
   *
   * Bypasses the tier device-limit deliberately: a user's own browser
   * shouldn't consume one of their PERSONAL_FREE device slots.
   */
  async createBrowserDevice(
    userId: string,
    browserDeviceId: string,
    name: string,
    mobility: DeviceMobility,
    networkId?: string,
  ): Promise<DeviceDto> {
    const existing = await this.devicesRepository.findByUserIdAndBrowserDeviceId(
      userId,
      browserDeviceId,
    );
    if (existing) return this.toDto(existing);

    const nameTaken = await this.devicesRepository.existsByNameCaseInsensitive(userId, name);
    if (nameTaken) {
      throw new NodeScopeException('DEVICE_003', 'DEVICE_NAME_TAKEN', HttpStatus.CONFLICT);
    }

    const device = await this.devicesRepository.create({
      userId,
      name,
      category: DeviceCategory.BROWSER_CLIENT,
      mobility,
      browserDeviceId,
      networkId,
    });
    const dto = this.toDto(device);
    this.conflictService.emitEntityEvent(
      WS_EVENTS.DEVICE_UPDATED,
      { deviceId: device.id, device: dto, updatedBy: userId },
      userId,
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
