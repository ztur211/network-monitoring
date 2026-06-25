import { Device } from '@prisma/client';
import { DeviceDto } from '@nodescope/shared';

/**
 * Converts a Prisma Device record to the shared DeviceDto transport shape.
 * Extracted so services outside the devices module (e.g. SpatialService) can
 * map without importing DevicesService — Rule #9: one responsibility.
 */
export function toDeviceDto(device: Device): DeviceDto {
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
    x: device.x,
    y: device.y,
    z: device.z,
    ifcGlobalId: device.ifcGlobalId,
    ipAddress: device.ipAddress,
    macAddress: device.macAddress,
    notes: device.notes,
    version: device.version,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}
