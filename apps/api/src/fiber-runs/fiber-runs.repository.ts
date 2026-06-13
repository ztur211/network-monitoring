import { Injectable } from '@nestjs/common';
import { FiberRun, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateFiberRunData = {
  organizationId: string;
  userId: string | null;
  name: string;
  startDeviceId: string;
  endDeviceId: string;
  cableType?: string;
  lengthMeters?: number;
  notes?: string;
};

@Injectable()
export class FiberRunsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllByOrgId(organizationId: string, deviceId?: string): Promise<FiberRun[]> {
    return this.prisma.fiberRun.findMany({
      where: {
        organizationId,
        ...(deviceId && {
          OR: [{ startDeviceId: deviceId }, { endDeviceId: deviceId }],
        }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  countByOrgId(organizationId: string): Promise<number> {
    return this.prisma.fiberRun.count({ where: { organizationId } });
  }

  findByIdAndOrgId(fiberRunId: string, organizationId: string): Promise<FiberRun | null> {
    return this.prisma.fiberRun.findFirst({ where: { id: fiberRunId, organizationId } });
  }

  create(data: CreateFiberRunData): Promise<FiberRun> {
    return this.prisma.fiberRun.create({ data });
  }

  async updateWithVersion(
    fiberRunId: string,
    organizationId: string,
    data: Prisma.FiberRunUpdateInput,
    expectedVersion: number,
  ): Promise<FiberRun | null> {
    const result = await this.prisma.fiberRun.updateMany({
      where: { id: fiberRunId, organizationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.fiberRun.findUnique({ where: { id: fiberRunId } });
  }

  async deleteByIdAndOrgId(fiberRunId: string, organizationId: string): Promise<void> {
    await this.prisma.fiberRun.deleteMany({ where: { id: fiberRunId, organizationId } });
  }
}
