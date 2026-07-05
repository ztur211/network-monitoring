import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricReader } from './alert-metric-evaluator.service';

@Injectable()
export class TimescaleMetricReader implements MetricReader {
  constructor(private readonly prisma: PrismaService) {}

  async sustainedLatencyOverWindow(orgId: string, deviceIds: string[] | null, sinceSeconds: number, op: string): Promise<Array<{ deviceId: string; value: number | null }>> {
    const since = new Date(Date.now() - sinceSeconds * 1000);
    const deviceFilter =
      deviceIds && deviceIds.length
        ? Prisma.sql`AND "deviceId" IN (${Prisma.join(deviceIds)})`
        : Prisma.empty;
    // A breach must be sustained across the whole window, not a single spike: for `gt` every
    // sample must be above the threshold (the MIN over the window), for `lt` every sample must
    // be below it (the MAX over the window).
    const agg = op === 'lt' ? Prisma.sql`MAX(value)` : Prisma.sql`MIN(value)`;
    return this.prisma.$queryRaw<Array<{ deviceId: string; value: number | null }>>(Prisma.sql`
      SELECT "deviceId", ${agg} AS value
      FROM "MonitoringMetric"
      WHERE "organizationId" = ${orgId} AND metric = 'latency_ms' AND time >= ${since}
      ${deviceFilter}
      GROUP BY "deviceId"`);
  }
}
