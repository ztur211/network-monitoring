import { HttpStatus, Injectable } from '@nestjs/common';
import { Circuit, Prisma } from '@prisma/client';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

type CreateCircuitData = {
  organizationId: string;
  userId: string | null;
  ispName: string;
  serviceType: string;
  circuitId?: string;
  bandwidth?: number;
  deviceId?: string;
  notes?: string;
};

type CursorPayload = {
  createdAt: string;
  id: string;
};

/** Scope filter for site-bound circuit reads. `null` = OWNER (unscoped). */
export type CircuitScope = { propertyIdIn: string[] } | null;

@Injectable()
export class CircuitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findWithCursor(
    organizationId: string,
    limit: number,
    cursor?: string,
    scope?: CircuitScope,
  ): Promise<Circuit[]> {
    const scopeClause: Prisma.CircuitWhereInput = scope
      ? { device: { propertyId: { in: scope.propertyIdIn } } }
      : {};

    let where: Prisma.CircuitWhereInput = { organizationId, ...scopeClause };

    if (cursor) {
      const decoded = this.decodeCursor(cursor);
      where = {
        organizationId,
        ...scopeClause,
        OR: [
          { createdAt: { lt: new Date(decoded.createdAt) } },
          { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
        ],
      };
    }

    return this.prisma.circuit.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  /**
   * Decodes the opaque base64 keyset cursor. The cursor comes straight from the
   * client (`?cursor=`, only `@IsString()`-validated), so a malformed value
   * must surface as a 400, not crash JSON.parse into a 500.
   */
  private decodeCursor(cursor: string): CursorPayload {
    try {
      return JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf-8'),
      ) as CursorPayload;
    } catch {
      throw new NodeScopeException('GEN_001', 'INVALID_CURSOR', HttpStatus.BAD_REQUEST);
    }
  }

  countByOrgId(organizationId: string, scope?: CircuitScope): Promise<number> {
    const scopeClause: Prisma.CircuitWhereInput = scope
      ? { device: { propertyId: { in: scope.propertyIdIn } } }
      : {};
    return this.prisma.circuit.count({ where: { organizationId, ...scopeClause } });
  }

  /** Org-wide lookup — used by the write path so an out-of-scope ADMIN gets PERM_001 rather than 404. */
  findByIdAndOrgId(circuitId: string, organizationId: string): Promise<Circuit | null> {
    return this.prisma.circuit.findFirst({ where: { id: circuitId, organizationId } });
  }

  /**
   * Scope-filtered lookup — used by the read path. A scoped ADMIN or MEMBER only sees a circuit
   * when its linked device's site is within their assigned scope. Device-less circuits (no
   * `device` row) are excluded for scoped members because the `device` relation filter fails to
   * match a null `deviceId`.
   */
  findVisibleByIdAndOrgId(
    circuitId: string,
    organizationId: string,
    scope: CircuitScope,
  ): Promise<Circuit | null> {
    const scopeClause: Prisma.CircuitWhereInput = scope
      ? { device: { propertyId: { in: scope.propertyIdIn } } }
      : {};
    return this.prisma.circuit.findFirst({
      where: { id: circuitId, organizationId, ...scopeClause },
    });
  }

  create(data: CreateCircuitData): Promise<Circuit> {
    return this.prisma.circuit.create({ data });
  }

  async updateWithVersion(
    circuitId: string,
    organizationId: string,
    data: Prisma.CircuitUpdateInput,
    expectedVersion: number,
  ): Promise<Circuit | null> {
    const result = await this.prisma.circuit.updateMany({
      where: { id: circuitId, organizationId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.circuit.findUnique({ where: { id: circuitId } });
  }

  async deleteByIdAndOrgId(circuitId: string, organizationId: string): Promise<void> {
    await this.prisma.circuit.deleteMany({ where: { id: circuitId, organizationId } });
  }
}
