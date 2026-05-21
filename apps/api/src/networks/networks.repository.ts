import { Injectable } from '@nestjs/common';
import { Network, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateNetworkData = {
  userId: string;
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

  findAllByUserId(userId: string): Promise<Network[]> {
    return this.prisma.network.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  countByUserId(userId: string): Promise<number> {
    return this.prisma.network.count({ where: { userId } });
  }

  findByIdAndUserId(networkId: string, userId: string): Promise<Network | null> {
    return this.prisma.network.findFirst({ where: { id: networkId, userId } });
  }

  create(data: CreateNetworkData): Promise<Network> {
    return this.prisma.network.create({ data });
  }

  async updateWithVersion(
    networkId: string,
    userId: string,
    data: Prisma.NetworkUpdateInput,
    expectedVersion: number,
  ): Promise<Network | null> {
    const result = await this.prisma.network.updateMany({
      where: { id: networkId, userId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.network.findUnique({ where: { id: networkId } });
  }

  async deleteByIdAndUserId(networkId: string, userId: string): Promise<void> {
    await this.prisma.network.deleteMany({ where: { id: networkId, userId } });
  }
}
