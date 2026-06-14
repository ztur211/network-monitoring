import { Injectable } from '@nestjs/common';
import { Device, DeviceCategory, DeviceMobility, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateDeviceData = {
  organizationId: string;
  userId: string | null;
  name: string;
  category: DeviceCategory;
  mobility?: DeviceMobility;
  networkId: string;
  propertyId: string;
  roleCode?: string;
  latitude?: number;
  longitude?: number;
  floor?: number;
  floorLabel?: string;
  ipAddress?: string;
  macAddress?: string;
  notes?: string;
};

/** A non-null scope restricts reads to devices whose propertyId is in the given set. */
export type DeviceScope = { propertyIdIn: string[] } | null;

@Injectable()
export class DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllByOrgId(organizationId: string, scope?: DeviceScope): Promise<Device[]> {
    return this.prisma.device.findMany({
      where: { organizationId, ...(scope ? { propertyId: { in: scope.propertyIdIn } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  countByOrgId(organizationId: string, scope?: DeviceScope): Promise<number> {
    return this.prisma.device.count({
      where: { organizationId, ...(scope ? { propertyId: { in: scope.propertyIdIn } } : {}) },
    });
  }

  findByIdAndOrgId(deviceId: string, organizationId: string, scope?: DeviceScope): Promise<Device | null> {
    return this.prisma.device.findFirst({
      where: { id: deviceId, organizationId, ...(scope ? { propertyId: { in: scope.propertyIdIn } } : {}) },
    });
  }

  create(data: CreateDeviceData): Promise<Device> {
    return this.prisma.device.create({ data });
  }

  async updateWithVersion(
    deviceId: string,
    organizationId: string,
    data: Prisma.DeviceUpdateInput,
    expectedVersion: number,
  ): Promise<Device | null> {
    const result = await this.prisma.device.updateMany({
      where: { id: deviceId, organizationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.device.findUnique({ where: { id: deviceId } });
  }

  async deleteByIdAndOrgId(deviceId: string, organizationId: string): Promise<void> {
    await this.prisma.device.deleteMany({ where: { id: deviceId, organizationId } });
  }

  async existsByNameCaseInsensitive(
    organizationId: string,
    name: string,
    excludeDeviceId?: string,
  ): Promise<boolean> {
    const device = await this.prisma.device.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeDeviceId && { NOT: { id: excludeDeviceId } }),
      },
      select: { id: true },
    });
    return device !== null;
  }
}
