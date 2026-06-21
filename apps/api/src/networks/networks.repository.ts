import { Injectable } from '@nestjs/common';
import { Network, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { updateOrNull } from '../common/prisma/update-or-null';

type CreateNetworkData = {
  organizationId: string;
  userId: string | null;
  name: string;
  homeAddress?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  homePublicIp?: string;
  isp?: string;
  downMbps?: number;
  upMbps?: number;
};

@Injectable()
export class NetworksRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllByOrgId(organizationId: string): Promise<Network[]> {
    return this.prisma.network.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  countByOrgId(organizationId: string): Promise<number> {
    return this.prisma.network.count({ where: { organizationId } });
  }

  findByIdAndOrgId(networkId: string, organizationId: string): Promise<Network | null> {
    return this.prisma.network.findFirst({ where: { id: networkId, organizationId } });
  }

  listVisible(organizationId: string, scope: { propertyIdIn: string[] } | null): Promise<Network[]> {
    if (!scope) return this.findAllByOrgId(organizationId);
    return this.prisma.network.findMany({
      where: {
        organizationId,
        OR: [
          { networkLinks: { some: { propertyId: { in: scope.propertyIdIn } } } },
          { devices: { some: { propertyId: { in: scope.propertyIdIn } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findVisibleByIdAndOrgId(
    networkId: string,
    organizationId: string,
    scope: { propertyIdIn: string[] } | null,
  ): Promise<Network | null> {
    if (!scope) return this.findByIdAndOrgId(networkId, organizationId);
    return this.prisma.network.findFirst({
      where: {
        id: networkId,
        organizationId,
        OR: [
          { networkLinks: { some: { propertyId: { in: scope.propertyIdIn } } } },
          { devices: { some: { propertyId: { in: scope.propertyIdIn } } } },
        ],
      },
    });
  }

  async charteredPropertyIds(organizationId: string, networkId: string): Promise<string[]> {
    const rows = await this.prisma.networkProperty.findMany({
      where: { organizationId, networkId },
      select: { propertyId: true },
    });
    return rows.map((r) => r.propertyId);
  }

  async deviceFootprintPropertyIds(organizationId: string, networkId: string): Promise<string[]> {
    const rows = await this.prisma.device.findMany({
      where: { organizationId, networkId },
      distinct: ['propertyId'],
      select: { propertyId: true },
    });
    return rows.map((r) => r.propertyId);
  }

  /**
   * Used only by checkOnHome (called from the realtime gateway with a userId).
   * Finds all networks belonging to the organization the user is a member of.
   * In MVP every user belongs to at most one org.
   */
  findAllByMemberUserId(userId: string): Promise<Network[]> {
    return this.prisma.network.findMany({
      where: {
        organization: {
          members: { some: { userId } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: CreateNetworkData): Promise<Network> {
    return this.prisma.network.create({ data });
  }

  async updateWithVersion(
    networkId: string,
    organizationId: string,
    data: Prisma.NetworkUpdateInput,
    expectedVersion: number,
  ): Promise<Network | null> {
    return updateOrNull(() =>
      this.prisma.network.update({
        where: { id: networkId, organizationId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      }),
    );
  }

  async deleteByIdAndOrgId(networkId: string, organizationId: string): Promise<void> {
    await this.prisma.network.deleteMany({ where: { id: networkId, organizationId } });
  }
}
