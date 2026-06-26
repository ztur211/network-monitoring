import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Low-level read access to the Property hierarchy. Both PermissionsRepository and PropertiesRepository
 * need the "self + all ancestors" upward walk; it previously existed as two near-identical recursive
 * CTEs (one org-filtered in the recursive step, one not). Consolidated here into a single
 * implementation — the org-filtered (defence-in-depth) variant — in a Prisma-only provider so the
 * shared query lives once without forcing a Permissions <-> Properties module cycle.
 */
@Injectable()
export class PropertyTreeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The property and every ancestor up to the root (org-scoped), via an upward recursive CTE. */
  async ancestorIds(organizationId: string, propertyId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT "id", "parentId" FROM "Property"
          WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p."id", p."parentId" FROM "Property" p
          JOIN ancestors a ON p."id" = a."parentId" AND p."organizationId" = ${organizationId}
      )
      SELECT "id" FROM ancestors;
    `;
    return rows.map((r) => r.id);
  }
}
