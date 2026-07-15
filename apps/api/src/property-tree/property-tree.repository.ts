import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PropertyType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NodeScopeException } from '../common/filters/global-exception.filter';

/** A node of the Property hierarchy as returned by the shared tree walks. */
export interface PropertyTreeNode {
  id: string;
  type: PropertyType;
  code: string | null;
}

/**
 * Raised when the stored hierarchy contains a parent/child cycle. This is a data-integrity fault,
 * not a client mistake, so it is a 500: the request cannot be answered correctly and we refuse to
 * answer it at all. See the class comment for why refusing is the only safe option.
 */
export const PROPERTY_TREE_CYCLE = 'PROP_006';

/** Shape of a row from either recursive walk; `isCycle` is set by Postgres' CYCLE clause. */
type WalkRow = { id: string; isCycle: boolean };
type AncestorRow = WalkRow & { type: PropertyType; code: string | null };

/**
 * Low-level read access to the Property hierarchy, and the ONLY place in the codebase that walks it
 * recursively. Every caller (permissions scoping, properties, spatial, containment) goes through the
 * two walks below so the cycle guard can never be forgotten by a future traversal.
 *
 * ## Why the CYCLE clause, and why we throw
 *
 * Nothing in the schema prevents a cycle: `Property.parentId` is a self-referencing FK, so a bad
 * restore, a manual SQL fix, or a bulk import can persist `a.parent = b; b.parent = a`. The
 * application-level reparent check cannot save us either, since it is itself a tree walk and so
 * cannot inspect a cycle that ALREADY exists.
 *
 * A plain `UNION ALL` walk over a cyclic graph never terminates: it spins inside Postgres until the
 * statement is killed. Because `PermissionsService.scopePropertyIds` sits on the authorization path
 * of nearly every request, one cyclic row would pin one backend connection per request until the
 * Prisma pool is exhausted and the whole API stops serving - an outage that survives a restart,
 * because the cycle lives in the data.
 *
 * Of the three ways to make the walk terminate, only one is safe here:
 *
 * - `UNION` (dedupe) terminates, but silently returns the set of nodes REACHABLE through the cycle.
 *   On the downward walk that is strictly MORE ids than the caller is entitled to: with the edge
 *   `site.parent = floor`, the subtree of that floor now contains the site above it and every other
 *   building under it. An ADMIN assigned only to the floor would silently be scoped over the whole
 *   site. That is privilege escalation - it fails OPEN, with no error.
 * - A depth cap (`WHERE depth < N`) fails open in exactly the same way (it just stops after N laps),
 *   AND it silently truncates a legitimately deep tree. There is no defensible N in any case:
 *   `ALLOWED_CHILDREN` permits SITE > SITE and AREA > AREA, so a valid tree has no bounded depth,
 *   and truncating one would silently UNDER-scope a permission instead.
 * - The Postgres 14+ `CYCLE` clause detects the repeat explicitly and flags the offending row. It
 *   cannot false-positive here: a Property has exactly one parent, so within a single walk a node is
 *   reachable exactly once unless there is a genuine cycle.
 *
 * So we detect and refuse. A cycle means we cannot compute a correct answer, and on an authorization
 * path a wrong answer that grants too much is far worse than a loud failure. Throwing fails CLOSED,
 * leaks no access, holds no connection, is scoped to the one organization whose data is corrupt, and
 * names the offending rows in the log so an operator can actually fix them.
 */
@Injectable()
export class PropertyTreeRepository {
  private readonly logger = new Logger(PropertyTreeRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The property and every ancestor up to the root (org-scoped), ordered self -> root.
   *
   * The org filter is re-asserted on the recursive step (defence-in-depth) so the walk can never
   * cross into another organization even if a row's parentId ever pointed outside it.
   */
  async ancestorChain(organizationId: string, propertyId: string): Promise<PropertyTreeNode[]> {
    const rows = await this.prisma.$queryRaw<AncestorRow[]>`
      WITH RECURSIVE chain AS (
        SELECT "id", "parentId", "type", "code", 0 AS depth FROM "Property"
          WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p."id", p."parentId", p."type", p."code", c.depth + 1 FROM "Property" p
          JOIN chain c ON p."id" = c."parentId" AND p."organizationId" = ${organizationId}
      ) CYCLE "id" SET "isCycle" USING "cyclePath"
      SELECT "id", "type", "code", "isCycle" FROM chain ORDER BY depth ASC;
    `;
    this.assertAcyclic(rows, organizationId, propertyId, 'ancestors');
    return rows.map((r) => ({ id: r.id, type: r.type, code: r.code }));
  }

  /** Ids of the property and every ancestor up to the root (org-scoped), ordered self -> root. */
  async ancestorIds(organizationId: string, propertyId: string): Promise<string[]> {
    return (await this.ancestorChain(organizationId, propertyId)).map((n) => n.id);
  }

  /**
   * The property and every descendant (org-scoped). Backs `scopePropertyIds`, the basis of every
   * authorization decision, so a cycle here must never silently widen the result - see the class
   * comment.
   */
  async subtreeIds(organizationId: string, rootId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<WalkRow[]>`
      WITH RECURSIVE subtree AS (
        SELECT "id" FROM "Property"
          WHERE "id" = ${rootId} AND "organizationId" = ${organizationId}
        UNION ALL
        SELECT p."id" FROM "Property" p
          JOIN subtree s ON p."parentId" = s."id" AND p."organizationId" = ${organizationId}
      ) CYCLE "id" SET "isCycle" USING "cyclePath"
      SELECT "id", "isCycle" FROM subtree;
    `;
    this.assertAcyclic(rows, organizationId, rootId, 'subtree');
    return rows.map((r) => r.id);
  }

  /** True if `descendantId` is `ancestorId`, or sits anywhere beneath it (org-scoped). */
  async isAtOrUnder(organizationId: string, descendantId: string, ancestorId: string): Promise<boolean> {
    const ids = await this.ancestorIds(organizationId, descendantId);
    return ids.includes(ancestorId);
  }

  /**
   * Postgres' CYCLE clause emits the row that closes the cycle with `isCycle` set, then stops
   * recursing. Any such row means the stored tree is corrupt: refuse the request rather than return
   * a silently wrong id set, and log the offending nodes so the cycle can be found and broken.
   */
  private assertAcyclic(
    rows: WalkRow[],
    organizationId: string,
    startId: string,
    direction: 'ancestors' | 'subtree',
  ): void {
    const repeated = rows.filter((r) => r.isCycle).map((r) => r.id);
    if (repeated.length === 0) return;
    this.logger.error(
      {
        organizationId,
        startId,
        direction,
        cycleClosesAt: repeated,
        visited: rows.filter((r) => !r.isCycle).map((r) => r.id),
      },
      'Property hierarchy contains a cycle; refusing to compute a scope from corrupt data',
    );
    throw new NodeScopeException(
      PROPERTY_TREE_CYCLE,
      'PROPERTY_TREE_CYCLE',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
