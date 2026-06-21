import { Injectable } from '@nestjs/common';
import { FiberRun, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { updateOrNull } from '../common/prisma/update-or-null';

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

/** Non-null restricts reads to links where at least one endpoint device is in the given sites. */
export type FiberRunScope = { propertyIdIn: string[] } | null;

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

  listVisible(organizationId: string, scope: FiberRunScope, deviceId?: string): Promise<FiberRun[]> {
    const and: Prisma.FiberRunWhereInput[] = [];
    if (deviceId) and.push({ OR: [{ startDeviceId: deviceId }, { endDeviceId: deviceId }] });
    if (scope) {
      and.push({
        OR: [
          { startDevice: { propertyId: { in: scope.propertyIdIn } } },
          { endDevice: { propertyId: { in: scope.propertyIdIn } } },
        ],
      });
    }
    return this.prisma.fiberRun.findMany({
      where: { organizationId, ...(and.length ? { AND: and } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findVisibleByIdAndOrgId(id: string, organizationId: string, scope: FiberRunScope): Promise<FiberRun | null> {
    return this.prisma.fiberRun.findFirst({
      where: {
        id,
        organizationId,
        ...(scope ? {
          OR: [
            { startDevice: { propertyId: { in: scope.propertyIdIn } } },
            { endDevice: { propertyId: { in: scope.propertyIdIn } } },
          ],
        } : {}),
      },
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
    return updateOrNull(() =>
      this.prisma.fiberRun.update({
        where: { id: fiberRunId, organizationId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      }),
    );
  }

  async deleteByIdAndOrgId(fiberRunId: string, organizationId: string): Promise<void> {
    await this.prisma.fiberRun.deleteMany({ where: { id: fiberRunId, organizationId } });
  }
}
