import { Injectable } from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyTreeRepository } from '../property-tree/property-tree.repository';
import { updateOrNull } from '../common/prisma/update-or-null';

/**
 * DB access for device 3D spatial coordinates and property-tree traversal (Spec 1).
 * Only this repository touches PrismaService for the spatial concern (Rule #2).
 */
@Injectable()
export class SpatialRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: PropertyTreeRepository,
  ) {}

  findDevice(organizationId: string, deviceId: string): Promise<Device | null> {
    return this.prisma.device.findFirst({ where: { id: deviceId, organizationId } });
  }

  /**
   * Nearest BUILDING ancestor-or-self of `propertyId`, or null if none up the chain.
   *
   * Walks via the shared PropertyTreeRepository rather than a local recursive CTE: that is the one
   * cycle-guarded implementation of the upward walk, so a corrupt tree raises PROPERTY_TREE_CYCLE
   * instead of spinning forever inside Postgres. The chain is bounded by the tree's depth, so
   * picking the nearest BUILDING in application code costs nothing over the old SQL `LIMIT 1`.
   */
  async resolveGoverningBuildingId(organizationId: string, propertyId: string): Promise<string | null> {
    const chain = await this.tree.ancestorChain(organizationId, propertyId); // self -> root
    return chain.find((n) => n.type === 'BUILDING')?.id ?? null;
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
