import { Injectable } from '@nestjs/common';
import { FiberRun, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateFiberRunData = {
  userId: string;
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

  findAllByUserId(userId: string, deviceId?: string): Promise<FiberRun[]> {
    return this.prisma.fiberRun.findMany({
      where: {
        userId,
        ...(deviceId && {
          OR: [{ startDeviceId: deviceId }, { endDeviceId: deviceId }],
        }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  countByUserId(userId: string): Promise<number> {
    return this.prisma.fiberRun.count({ where: { userId } });
  }

  findByIdAndUserId(fiberRunId: string, userId: string): Promise<FiberRun | null> {
    return this.prisma.fiberRun.findFirst({ where: { id: fiberRunId, userId } });
  }

  create(data: CreateFiberRunData): Promise<FiberRun> {
    return this.prisma.fiberRun.create({ data });
  }

  async updateWithVersion(
    fiberRunId: string,
    userId: string,
    data: Prisma.FiberRunUpdateInput,
    expectedVersion: number,
  ): Promise<FiberRun | null> {
    const result = await this.prisma.fiberRun.updateMany({
      where: { id: fiberRunId, userId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.fiberRun.findUnique({ where: { id: fiberRunId } });
  }

  async deleteByIdAndUserId(fiberRunId: string, userId: string): Promise<void> {
    await this.prisma.fiberRun.deleteMany({ where: { id: fiberRunId, userId } });
  }
}
