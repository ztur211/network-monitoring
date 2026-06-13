import { Injectable } from '@nestjs/common';
import { NetworkProperty } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NetworkPropertyRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(organizationId: string, networkId: string, propertyId: string): Promise<NetworkProperty> {
    return this.prisma.networkProperty.create({ data: { organizationId, networkId, propertyId } });
  }

  existsCharter(organizationId: string, networkId: string, propertyId: string): Promise<NetworkProperty | null> {
    return this.prisma.networkProperty.findFirst({ where: { organizationId, networkId, propertyId } });
  }

  findByIdAndOrg(id: string, organizationId: string): Promise<NetworkProperty | null> {
    return this.prisma.networkProperty.findFirst({ where: { id, organizationId } });
  }

  listByNetwork(organizationId: string, networkId: string): Promise<NetworkProperty[]> {
    return this.prisma.networkProperty.findMany({ where: { organizationId, networkId }, orderBy: { createdAt: 'asc' } });
  }

  async propertyIdsByNetwork(organizationId: string, networkId: string): Promise<string[]> {
    const rows = await this.prisma.networkProperty.findMany({ where: { organizationId, networkId }, select: { propertyId: true } });
    return rows.map((r) => r.propertyId);
  }

  async deleteByNetworkAndProperty(organizationId: string, networkId: string, propertyId: string): Promise<number> {
    const res = await this.prisma.networkProperty.deleteMany({ where: { organizationId, networkId, propertyId } });
    return res.count;
  }
}
