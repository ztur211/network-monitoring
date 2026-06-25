import { Injectable } from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { updateOrNull } from '../common/prisma/update-or-null';

/**
 * DB access for device 3D spatial coordinates and property-tree traversal (Spec 1).
 * Only this repository touches PrismaService for the spatial concern (Rule #2).
 */
@Injectable()
export class SpatialRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDevice(organizationId: string, deviceId: string): Promise<Device | null> {
    return this.prisma.device.findFirst({ where: { id: deviceId, organizationId } });
  }

  /**
   * Nearest BUILDING ancestor-or-self of `propertyId`, or null if none up the chain.
   * Uses a recursive CTE to walk the property tree without loading every ancestor
   * into application memory.
   */
  async resolveGoverningBuildingId(organizationId: string, propertyId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE chain AS (
        SELECT "id", "parentId", "type", 0 AS depth FROM "Property"
          WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p."id", p."parentId", p."type", c.depth + 1 FROM "Property" p
          JOIN chain c ON p."id" = c."parentId" AND p."organizationId" = ${organizationId}
      )
      SELECT "id" FROM chain WHERE "type" = 'BUILDING' ORDER BY depth ASC LIMIT 1;
    `;
    return rows[0]?.id ?? null;
  }

  async setPosition(
    organizationId: string,
    deviceId: string,
    x: number | null,
    y: number | null,
    z: number | null,
  ): Promise<Device | null> {
    // updateMany + re-read is non-atomic (mirrors DevicesRepository.updateWithVersion);
    // acceptable for non-critical coordinate writes.
    return updateOrNull(() =>
      this.prisma.device.update({
        where: { id: deviceId, organizationId },
        data: { x, y, z, version: { increment: 1 } },
      }),
    );
  }

  /** Set (or clear, when null) the device's linked IFC element GlobalId. */
  async setIfcLink(
    organizationId: string,
    deviceId: string,
    ifcGlobalId: string | null,
  ): Promise<Device | null> {
    return updateOrNull(() =>
      this.prisma.device.update({
        where: { id: deviceId, organizationId },
        data: { ifcGlobalId, version: { increment: 1 } },
      }),
    );
  }
}
