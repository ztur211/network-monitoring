import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Per-entity row caps for the AI context. A single org's network can hold tens
 * of thousands of rows (a 10k-device org is a real scenario); loading all of it
 * into one system prompt is both a memory runaway (multi-MB string built with
 * O(n^2) joins in the provider) and a token-cost runaway (the whole thing is
 * shipped to the model on every turn). These caps bound the query itself.
 *
 * Devices are the primary entity and get the largest budget; connections scale
 * with devices; fibre runs and ISP circuits are far rarer, so they get less.
 * The four caps are sized so a fully-populated result lands near the provider's
 * network-section token budget while still describing a substantial network;
 * the provider then hard-truncates anything still over budget (belt and braces).
 *
 * Ordering is `createdAt DESC` so the newest entities survive the cap and the
 * provider's tail-truncation - the rows a user is actively documenting are the
 * ones most relevant to a live troubleshooting chat. For devices this is also
 * index-backed (`@@index([organizationId, createdAt])`), avoiding a full sort.
 */
const MAX_DEVICES = 200;
const MAX_CONNECTIONS = 200;
const MAX_FIBER_RUNS = 100;
const MAX_CIRCUITS = 100;

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
        orderBy: { createdAt: 'desc' },
        take: MAX_DEVICES,
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
        orderBy: { createdAt: 'desc' },
        take: MAX_CONNECTIONS,
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
        orderBy: { createdAt: 'desc' },
        take: MAX_FIBER_RUNS,
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
        orderBy: { createdAt: 'desc' },
        take: MAX_CIRCUITS,
      }),
    ]);

    return { devices, connections, fiberRuns, circuits };
  }
}
