import { Injectable } from '@nestjs/common';
import { Prisma, Property, PropertyType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyTreeRepository } from '../property-tree/property-tree.repository';

type PropertyScope = { propertyIdIn: string[] } | null;

@Injectable()
export class PropertiesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: PropertyTreeRepository,
  ) {}

  create(data: { organizationId: string; parentId: string | null; type: PropertyType; name: string; code: string | null }): Promise<Property> {
    return this.prisma.property.create({ data });
  }

  findByIdAndOrgId(id: string, organizationId: string, scope?: PropertyScope): Promise<Property | null> {
    return this.prisma.property.findFirst({
      where: {
        id,
        organizationId,
        ...(scope ? { AND: [{ id: { in: scope.propertyIdIn } }] } : {}),
      },
    });
  }

  findAllByOrgId(organizationId: string, scope?: PropertyScope): Promise<Property[]> {
    return this.prisma.property.findMany({
      where: { organizationId, ...(scope ? { id: { in: scope.propertyIdIn } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  findChildren(organizationId: string, parentId: string): Promise<Property[]> {
    return this.prisma.property.findMany({ where: { organizationId, parentId }, orderBy: { createdAt: 'asc' } });
  }

  countChildren(organizationId: string, parentId: string): Promise<number> {
    return this.prisma.property.count({ where: { organizationId, parentId } });
  }

  async existsSiblingName(organizationId: string, parentId: string | null, name: string, excludeId?: string): Promise<boolean> {
    const hit = await this.prisma.property.findFirst({
      where: {
        organizationId,
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
    return hit !== null;
  }

  async updateWithVersion(id: string, organizationId: string, data: Prisma.PropertyUpdateInput, expectedVersion: number): Promise<Property | null> {
    const res = await this.prisma.property.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) return null;
    return this.prisma.property.findUnique({ where: { id } });
  }

  async deleteByIdAndOrgId(id: string, organizationId: string): Promise<void> {
    await this.prisma.property.deleteMany({ where: { id, organizationId } });
  }

  /** The property + all descendants (org-scoped). Delegates to the shared PropertyTreeRepository
   *  (single, cycle-guarded source of the downward walk). */
  getSubtreeIds(organizationId: string, rootId: string): Promise<string[]> {
    return this.tree.subtreeIds(organizationId, rootId);
  }

  /** True if `descendantId` is `ancestorId` or sits anywhere beneath it (org-scoped). */
  isAtOrUnder(organizationId: string, descendantId: string, ancestorId: string): Promise<boolean> {
    return this.tree.isAtOrUnder(organizationId, descendantId, ancestorId);
  }

  /** Self + all ancestors (org-scoped). Delegates to the shared PropertyTreeRepository (single,
   *  cycle-guarded source of the upward walk). */
  getAncestorIds(organizationId: string, id: string): Promise<string[]> {
    return this.tree.ancestorIds(organizationId, id);
  }

  /** Self -> root ordered by depth ASC, returning type + code for naming-token resolution. */
  async getAncestorChain(organizationId: string, id: string): Promise<{ type: PropertyType; code: string | null }[]> {
    const chain = await this.tree.ancestorChain(organizationId, id);
    return chain.map((n) => ({ type: n.type, code: n.code }));
  }

  devicesUnder(organizationId: string, propertyIds: string[]): Promise<{ id: string; networkId: string; propertyId: string }[]> {
    if (propertyIds.length === 0) return Promise.resolve([]);
    return this.prisma.device.findMany({
      where: { organizationId, propertyId: { in: propertyIds } },
      select: { id: true, networkId: true, propertyId: true },
    });
  }

  countDevicesUnder(organizationId: string, propertyIds: string[]): Promise<number> {
    if (propertyIds.length === 0) return Promise.resolve(0);
    return this.prisma.device.count({ where: { organizationId, propertyId: { in: propertyIds } } });
  }

  countChartersUnder(organizationId: string, propertyIds: string[]): Promise<number> {
    if (propertyIds.length === 0) return Promise.resolve(0);
    return this.prisma.networkProperty.count({ where: { organizationId, propertyId: { in: propertyIds } } });
  }

  // Spec 1 §4.4: a BUILDING with a model can't be deleted (MODEL_008). Read here (not
  // via BuildingModelsRepository) to avoid a PropertiesModule ↔ BuildingModelsModule cycle.
  countBuildingModelsUnder(organizationId: string, propertyIds: string[]): Promise<number> {
    if (propertyIds.length === 0) return Promise.resolve(0);
    return this.prisma.buildingModel.count({ where: { organizationId, propertyId: { in: propertyIds } } });
  }

  async countAssignmentsUnder(organizationId: string, propertyIds: string[]): Promise<number> {
    if (propertyIds.length === 0) return 0;
    const [teams, members] = await Promise.all([
      this.prisma.teamProperty.count({ where: { organizationId, propertyId: { in: propertyIds } } }),
      this.prisma.memberProperty.count({ where: { organizationId, propertyId: { in: propertyIds } } }),
    ]);
    return teams + members;
  }
}
