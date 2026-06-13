import { Injectable } from '@nestjs/common';
import { Network, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
    const result = await this.prisma.network.updateMany({
      where: { id: networkId, organizationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.network.findUnique({ where: { id: networkId } });
  }

  async deleteByIdAndOrgId(networkId: string, organizationId: string): Promise<void> {
    await this.prisma.network.deleteMany({ where: { id: networkId, organizationId } });
  }
}
