import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricReader } from './alert-metric-evaluator.service';

@Injectable()
export class TimescaleMetricReader implements MetricReader {
  constructor(private readonly prisma: PrismaService) {}

  async maxLatencyOverWindow(orgId: string, deviceIds: string[] | null, sinceSeconds: number): Promise<Array<{ deviceId: string; value: number | null }>> {
    const since = new Date(Date.now() - sinceSeconds * 1000);
    const deviceFilter =
      deviceIds && deviceIds.length
        ? Prisma.sql`AND "deviceId" IN (${Prisma.join(deviceIds)})`
        : Prisma.empty;
    return this.prisma.$queryRaw<Array<{ deviceId: string; value: number | null }>>(Prisma.sql`
      SELECT "deviceId", MAX(value) AS value
      FROM "MonitoringMetric"
      WHERE "organizationId" = ${orgId} AND metric = 'latency_ms' AND time >= ${since}
      ${deviceFilter}
      GROUP BY "deviceId"`);
  }
}
