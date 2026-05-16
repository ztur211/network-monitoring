import { Injectable } from '@nestjs/common';
import { DeviceMetric, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface CreateMetricData {
  userId: string;
  sourceType: string;
  bandwidthDown?: number | null;
  bandwidthUp?: number | null;
  latency?: number | null;
  connectionQuality?: string | null;
}

@Injectable()
export class DataSourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMetric(data: CreateMetricData): Promise<void> {
    await this.prisma.deviceMetric.create({ data });
  }

  async findLatestForUser(userId: string): Promise<DeviceMetric | null> {
    return this.prisma.deviceMetric.findFirst({
      where: { userId },
      orderBy: { time: 'desc' },
    });
  }

  async findLatestForUsers(userIds: string[]): Promise<DeviceMetric[]> {
    if (userIds.length === 0) return [];

    // DISTINCT ON keeps the most recent row per userId in one pass (TimescaleDB-friendly)
    const idList = Prisma.join(userIds.map((id) => Prisma.sql`${id}`));
    return this.prisma.$queryRaw<DeviceMetric[]>`
      SELECT DISTINCT ON ("userId")
        id, "userId", "sourceType", "bandwidthDown", "bandwidthUp",
        latency, "connectionQuality", time
      FROM "DeviceMetric"
      WHERE "userId" IN (${idList})
      ORDER BY "userId", time DESC
    `;
  }
}
