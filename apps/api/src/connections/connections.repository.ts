import { Injectable } from '@nestjs/common';
import { ConnectionType, DeviceConnection, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateConnectionData = {
  organizationId: string;
  userId: string | null;
  sourceDeviceId: string;
  targetDeviceId: string;
  connectionType: ConnectionType;
  notes?: string;
};

/** Non-null restricts reads to links where at least one endpoint device is in the given sites. */
export type LinkScope = { propertyIdIn: string[] } | null;

@Injectable()
export class ConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllByOrgId(organizationId: string, deviceId?: string): Promise<DeviceConnection[]> {
    return this.prisma.deviceConnection.findMany({
      where: {
        organizationId,
        ...(deviceId && {
          OR: [{ sourceDeviceId: deviceId }, { targetDeviceId: deviceId }],
        }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listVisible(organizationId: string, scope: LinkScope, deviceId?: string): Promise<DeviceConnection[]> {
    const and: Prisma.DeviceConnectionWhereInput[] = [];
    if (deviceId) and.push({ OR: [{ sourceDeviceId: deviceId }, { targetDeviceId: deviceId }] });
    if (scope) {
      and.push({
        OR: [
          { sourceDevice: { propertyId: { in: scope.propertyIdIn } } },
          { targetDevice: { propertyId: { in: scope.propertyIdIn } } },
        ],
      });
    }
    return this.prisma.deviceConnection.findMany({
      where: { organizationId, ...(and.length ? { AND: and } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findVisibleByIdAndOrgId(id: string, organizationId: string, scope: LinkScope): Promise<DeviceConnection | null> {
    return this.prisma.deviceConnection.findFirst({
      where: {
        id,
        organizationId,
        ...(scope ? {
          OR: [
            { sourceDevice: { propertyId: { in: scope.propertyIdIn } } },
            { targetDevice: { propertyId: { in: scope.propertyIdIn } } },
          ],
        } : {}),
      },
    });
  }

  countByOrgId(organizationId: string): Promise<number> {
    return this.prisma.deviceConnection.count({ where: { organizationId } });
  }

  findByIdAndOrgId(connectionId: string, organizationId: string): Promise<DeviceConnection | null> {
    return this.prisma.deviceConnection.findFirst({ where: { id: connectionId, organizationId } });
  }

  create(data: CreateConnectionData): Promise<DeviceConnection> {
    return this.prisma.deviceConnection.create({ data });
  }

  async updateWithVersion(
    connectionId: string,
    organizationId: string,
    data: Prisma.DeviceConnectionUpdateInput,
    expectedVersion: number,
  ): Promise<DeviceConnection | null> {
    const result = await this.prisma.deviceConnection.updateMany({
      where: { id: connectionId, organizationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.deviceConnection.findUnique({ where: { id: connectionId } });
  }

  async deleteByIdAndOrgId(connectionId: string, organizationId: string): Promise<void> {
    await this.prisma.deviceConnection.deleteMany({ where: { id: connectionId, organizationId } });
  }

  async existsDuplicate(
    organizationId: string,
    sourceDeviceId: string,
    targetDeviceId: string,
    connectionType: ConnectionType,
  ): Promise<boolean> {
    const conn = await this.prisma.deviceConnection.findFirst({
      where: { organizationId, sourceDeviceId, targetDeviceId, connectionType },
      select: { id: true },
    });
    return conn !== null;
  }
}
