import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Reads the user's documented network for AI context assembly. Exists so the
 * NetworkContextProvider (a service-layer class) doesn't touch Prisma directly
 * — CLAUDE.md Rule #2: only *.repository.ts files access the ORM.
 */
@Injectable()
export class NetworkContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getNetworkEntities(organizationId: string, scopeIds: string[] | null) {
    const [devices, connections, fiberRuns, circuits] = await Promise.all([
      this.prisma.device.findMany({
        where: {
          organizationId,
          ...(scopeIds ? { propertyId: { in: scopeIds } } : {}),
        },
        select: {
          name: true, category: true, ipAddress: true, floor: true, floorLabel: true, notes: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.deviceConnection.findMany({
        where: {
          organizationId,
          ...(scopeIds ? {
            OR: [
              { sourceDevice: { propertyId: { in: scopeIds } } },
              { targetDevice: { propertyId: { in: scopeIds } } },
            ],
          } : {}),
        },
        select: {
          connectionType: true, notes: true,
          sourceDevice: { select: { name: true } },
          targetDevice: { select: { name: true } },
        },
      }),
      this.prisma.fiberRun.findMany({
        where: {
          organizationId,
          ...(scopeIds ? {
            OR: [
              { startDevice: { propertyId: { in: scopeIds } } },
              { endDevice: { propertyId: { in: scopeIds } } },
            ],
          } : {}),
        },
        select: {
          name: true, cableType: true, lengthMeters: true, notes: true,
          startDevice: { select: { name: true } },
          endDevice: { select: { name: true } },
        },
      }),
      this.prisma.circuit.findMany({
        where: {
          organizationId,
          ...(scopeIds ? { device: { propertyId: { in: scopeIds } } } : {}),
        },
        select: {
          ispName: true, circuitId: true, serviceType: true, bandwidth: true, notes: true,
          device: { select: { name: true } },
        },
      }),
    ]);

    return { devices, connections, fiberRuns, circuits };
  }
}
