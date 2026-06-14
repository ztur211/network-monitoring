import { Injectable } from '@nestjs/common';
import { Prisma, Property, PropertyType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PropertiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { organizationId: string; parentId: string | null; type: PropertyType; name: string; code: string | null }): Promise<Property> {
    return this.prisma.property.create({ data });
  }

  findByIdAndOrgId(id: string, organizationId: string): Promise<Property | null> {
    return this.prisma.property.findFirst({ where: { id, organizationId } });
  }

  findAllByOrgId(organizationId: string): Promise<Property[]> {
    return this.prisma.property.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
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

  /** The property + all descendants (org-scoped), via a recursive CTE. */
  async getSubtreeIds(organizationId: string, rootId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM "Property" WHERE id = ${rootId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p.id FROM "Property" p JOIN subtree s ON p."parentId" = s.id
      )
      SELECT id FROM subtree;
    `;
    return rows.map((r) => r.id);
  }

  /** True if `descendantId` is `ancestorId` or sits anywhere beneath it (org-scoped). */
  async isAtOrUnder(organizationId: string, descendantId: string, ancestorId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, "parentId" FROM "Property" WHERE id = ${descendantId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p.id, p."parentId" FROM "Property" p JOIN ancestors a ON p.id = a."parentId"
      )
      SELECT 1 AS ok FROM ancestors WHERE id = ${ancestorId} LIMIT 1;
    `;
    return rows.length > 0;
  }

  /** Self + all ancestors (org-scoped), via an upward recursive CTE. */
  async getAncestorIds(organizationId: string, id: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, "parentId" FROM "Property" WHERE id = ${id} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p.id, p."parentId" FROM "Property" p JOIN ancestors a ON p.id = a."parentId"
      )
      SELECT id FROM ancestors;`;
    return rows.map((r) => r.id);
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
}
