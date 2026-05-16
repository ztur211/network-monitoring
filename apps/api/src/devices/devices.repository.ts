import { Injectable } from '@nestjs/common';
import { Device, DeviceCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateDeviceData = {
  userId: string;
  name: string;
  category: DeviceCategory;
  latitude?: number;
  longitude?: number;
  floor?: number;
  floorLabel?: string;
  ipAddress?: string;
  macAddress?: string;
  notes?: string;
};

@Injectable()
export class DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllByUserId(userId: string): Promise<Device[]> {
    return this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  countByUserId(userId: string): Promise<number> {
    return this.prisma.device.count({ where: { userId } });
  }

  findByIdAndUserId(deviceId: string, userId: string): Promise<Device | null> {
    return this.prisma.device.findFirst({ where: { id: deviceId, userId } });
  }

  create(data: CreateDeviceData): Promise<Device> {
    return this.prisma.device.create({ data });
  }

  async updateWithVersion(
    deviceId: string,
    userId: string,
    data: Prisma.DeviceUpdateInput,
    expectedVersion: number,
  ): Promise<Device | null> {
    const result = await this.prisma.device.updateMany({
      where: { id: deviceId, userId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.device.findUnique({ where: { id: deviceId } });
  }

  async deleteByIdAndUserId(deviceId: string, userId: string): Promise<void> {
    await this.prisma.device.deleteMany({ where: { id: deviceId, userId } });
  }

  async existsByNameCaseInsensitive(
    userId: string,
    name: string,
    excludeDeviceId?: string,
  ): Promise<boolean> {
    const device = await this.prisma.device.findFirst({
      where: {
        userId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeDeviceId && { NOT: { id: excludeDeviceId } }),
      },
      select: { id: true },
    });
    return device !== null;
  }
}
