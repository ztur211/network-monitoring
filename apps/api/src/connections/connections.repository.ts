import { Injectable } from '@nestjs/common';
import { ConnectionType, DeviceConnection, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateConnectionData = {
  userId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  connectionType: ConnectionType;
  notes?: string;
};

@Injectable()
export class ConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllByUserId(userId: string, deviceId?: string): Promise<DeviceConnection[]> {
    return this.prisma.deviceConnection.findMany({
      where: {
        userId,
        ...(deviceId && {
          OR: [{ sourceDeviceId: deviceId }, { targetDeviceId: deviceId }],
        }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  countByUserId(userId: string): Promise<number> {
    return this.prisma.deviceConnection.count({ where: { userId } });
  }

  findByIdAndUserId(connectionId: string, userId: string): Promise<DeviceConnection | null> {
    return this.prisma.deviceConnection.findFirst({ where: { id: connectionId, userId } });
  }

  create(data: CreateConnectionData): Promise<DeviceConnection> {
    return this.prisma.deviceConnection.create({ data });
  }

  async updateWithVersion(
    connectionId: string,
    userId: string,
    data: Prisma.DeviceConnectionUpdateInput,
    expectedVersion: number,
  ): Promise<DeviceConnection | null> {
    const result = await this.prisma.deviceConnection.updateMany({
      where: { id: connectionId, userId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.deviceConnection.findUnique({ where: { id: connectionId } });
  }

  async deleteByIdAndUserId(connectionId: string, userId: string): Promise<void> {
    await this.prisma.deviceConnection.deleteMany({ where: { id: connectionId, userId } });
  }

  async existsDuplicate(
    userId: string,
    sourceDeviceId: string,
    targetDeviceId: string,
    connectionType: ConnectionType,
  ): Promise<boolean> {
    const conn = await this.prisma.deviceConnection.findFirst({
      where: { userId, sourceDeviceId, targetDeviceId, connectionType },
      select: { id: true },
    });
    return conn !== null;
  }
}
