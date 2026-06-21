import { Injectable } from '@nestjs/common';
import { DeviceStatus, DeviceStatusState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CAGG_BUCKET_SECONDS = 300; // granularity of the MonitoringMetric_5m continuous aggregate

/** Best-effort parse of a Postgres interval string ('5 minutes', '1 hour', …) to seconds. */
function bucketSeconds(bucket: string): number {
  const m = /^\s*(\d+)\s*(second|minute|hour|day|week)s?\s*$/i.exec(bucket);
  if (!m) return 0;
  const factors: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 };
  return Number(m[1]) * (factors[m[2].toLowerCase()] ?? 0);
}

/**
 * DeviceStatus current-state rows are Prisma-managed; MonitoringMetric and
 * DeviceStatusEvent are raw-SQL TimescaleDB hypertables (Prisma does not model
 * them) accessed via $executeRaw / $queryRaw.
 */
@Injectable()
export class MonitoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  getStatus(organizationId: string, deviceId: string): Promise<DeviceStatus | null> {
    return this.prisma.deviceStatus.findFirst({ where: { organizationId, deviceId } });
  }

  listStatus(organizationId: string, deviceIds: string[]): Promise<DeviceStatus[]> {
    return this.prisma.deviceStatus.findMany({
      where: { organizationId, deviceId: { in: deviceIds } },
    });
  }

  async upsertStatus(d: {
    organizationId: string;
    deviceId: string;
    state: DeviceStatusState;
    latencyMs: number | null;
    consecutiveFails: number;
    source: string;
    ok: boolean;
    changed?: boolean;
  }): Promise<void> {
    const now = new Date();
    await this.prisma.deviceStatus.upsert({
      where: { deviceId: d.deviceId },
      create: {
        organizationId: d.organizationId,
        deviceId: d.deviceId,
        state: d.state,
        latencyMs: d.latencyMs,
        consecutiveFails: d.consecutiveFails,
        source: d.source,
        lastCheckAt: now,
        lastOkAt: d.ok ? now : null,
        lastChangeAt: now,
      },
      update: {
        state: d.state,
        latencyMs: d.latencyMs,
        consecutiveFails: d.consecutiveFails,
        source: d.source,
        lastCheckAt: now,
        ...(d.ok ? { lastOkAt: now } : {}),
        ...(d.changed ? { lastChangeAt: now } : {}),
      },
    });
  }

  insertMetric(d: {
    organizationId: string;
    deviceId: string;
    metric: string;
    value: number;
    source: string;
    ts?: Date;
  }): Promise<unknown> {
    return this.prisma.$executeRaw`INSERT INTO "MonitoringMetric" ("time","organizationId","deviceId","metric","value","source")
      VALUES (${d.ts ?? new Date()}, ${d.organizationId}, ${d.deviceId}, ${d.metric}, ${d.value}, ${d.source})`;
  }

  insertStatusEvent(d: {
    organizationId: string;
    deviceId: string;
    state: DeviceStatusState;
    source: string;
  }): Promise<unknown> {
    return this.prisma.$executeRaw`INSERT INTO "DeviceStatusEvent" ("time","organizationId","deviceId","state","source")
      VALUES (${new Date()}, ${d.organizationId}, ${d.deviceId}, ${d.state}, ${d.source})`;
  }

  queryMetric(
    organizationId: string,
    deviceId: string,
    metric: string,
    from: Date,
    to: Date,
    bucket: string,
  ): Promise<{ bucket: Date; avg: number }[]> {
    // For buckets at/above the aggregate granularity, read the pre-aggregated 5-min rollup
    // (re-bucketed) instead of scanning the raw hypertable. Fall back to raw if the
    // aggregate is unavailable; finer buckets always use raw (the rollup can't serve them).
    if (bucketSeconds(bucket) >= CAGG_BUCKET_SECONDS) {
      return this.queryMetricFromCagg(organizationId, deviceId, metric, from, to, bucket).catch(() =>
        this.queryMetricFromRaw(organizationId, deviceId, metric, from, to, bucket),
      );
    }
    return this.queryMetricFromRaw(organizationId, deviceId, metric, from, to, bucket);
  }

  private queryMetricFromRaw(
    organizationId: string,
    deviceId: string,
    metric: string,
    from: Date,
    to: Date,
    bucket: string,
  ): Promise<{ bucket: Date; avg: number }[]> {
    return this.prisma.$queryRaw`SELECT time_bucket(${bucket}::interval, "time") AS bucket, avg("value")::float AS avg
      FROM "MonitoringMetric" WHERE "organizationId" = ${organizationId} AND "deviceId" = ${deviceId} AND "metric" = ${metric}
      AND "time" >= ${from} AND "time" <= ${to} GROUP BY bucket ORDER BY bucket`;
  }

  // Re-bucket the 5-min rollup to the requested bucket; avg = Σvalue / Σcount (weighted) is
  // mathematically identical to avg("value") over the raw rows.
  private queryMetricFromCagg(
    organizationId: string,
    deviceId: string,
    metric: string,
    from: Date,
    to: Date,
    bucket: string,
  ): Promise<{ bucket: Date; avg: number }[]> {
    return this.prisma.$queryRaw`SELECT time_bucket(${bucket}::interval, "bucket") AS bucket,
        (sum("sum_value")::float / NULLIF(sum("sample_count"), 0)) AS avg
      FROM "MonitoringMetric_5m" WHERE "organizationId" = ${organizationId} AND "deviceId" = ${deviceId} AND "metric" = ${metric}
      AND "bucket" >= ${from} AND "bucket" <= ${to} GROUP BY 1 ORDER BY 1`;
  }
}
