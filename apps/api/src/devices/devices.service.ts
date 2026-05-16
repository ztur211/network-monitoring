import { HttpStatus, Injectable } from '@nestjs/common';
import { Device } from '@prisma/client';
import { DeviceDto, PaginatedResponse } from '@nodescope/shared';
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

    await this.conflictService.publishEntityUpdate('Device', deviceId, userId);
    return this.toDto(updated);
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.devicesRepository.findByIdAndUserId(deviceId, userId);
    if (!device) {
      throw new NodeScopeException('DEVICE_001', 'DEVICE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.devicesRepository.deleteByIdAndUserId(deviceId, userId);
    await this.conflictService.publishEntityUpdate('Device', deviceId, userId);
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
      version: device.version,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    };
  }
}
