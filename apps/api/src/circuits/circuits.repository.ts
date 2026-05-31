import { HttpStatus, Injectable } from '@nestjs/common';
import { Circuit, Prisma } from '@prisma/client';
import { NodeScopeException } from '../common/filters/global-exception.filter';
import { PrismaService } from '../prisma/prisma.service';

type CreateCircuitData = {
  userId: string;
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

@Injectable()
export class CircuitsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findWithCursor(userId: string, limit: number, cursor?: string): Promise<Circuit[]> {
    let where: Prisma.CircuitWhereInput = { userId };

    if (cursor) {
      const decoded = this.decodeCursor(cursor);
      where = {
        userId,
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

  countByUserId(userId: string): Promise<number> {
    return this.prisma.circuit.count({ where: { userId } });
  }

  findByIdAndUserId(circuitId: string, userId: string): Promise<Circuit | null> {
    return this.prisma.circuit.findFirst({ where: { id: circuitId, userId } });
  }

  create(data: CreateCircuitData): Promise<Circuit> {
    return this.prisma.circuit.create({ data });
  }

  async updateWithVersion(
    circuitId: string,
    userId: string,
    data: Prisma.CircuitUpdateInput,
    expectedVersion: number,
  ): Promise<Circuit | null> {
    const result = await this.prisma.circuit.updateMany({
      where: { id: circuitId, userId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.circuit.findUnique({ where: { id: circuitId } });
  }

  async deleteByIdAndUserId(circuitId: string, userId: string): Promise<void> {
    await this.prisma.circuit.deleteMany({ where: { id: circuitId, userId } });
  }
}
