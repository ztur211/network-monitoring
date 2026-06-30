import { Injectable } from '@nestjs/common';
import { DeviceStatus, DeviceStatusState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CAGG_BUCKET_SECONDS = 300; // granularity of the MonitoringMetric_5m continuous aggregate

/** Best-effort parse of a Postgres interval string ('5 minutes', '1 hour', …) to seconds. */
export function bucketSeconds(bucket: string): number {
  const m = /^\s*(\d+)\s*(second|minute|hour|day|week)s?\s*$/i.exec(bucket);
  if (!m) return 0;
  const factors: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 };
  return Number(m[1]) * (factors[m[2].toLowerCase()] ?? 0);
}

/**
 * Whether a metric query may be served from the 5-min continuous aggregate instead of the raw
 * hypertable. The cagg pre-averages each 5-min bucket, so it can ONLY reproduce the raw result
 * when the requested window introduces no partial buckets — i.e. the requested bucket is a whole
 * multiple of 5 min AND `from`/`to` sit on the 5-min grid (TimescaleDB's time_bucket is
 * epoch-aligned, and a unix-ms multiple of 300_000 lands on a 5-min boundary).
 *
 * For an unaligned window the two paths legitimately differ at the edges (raw filters individual
 * samples by `time`; the cagg filters whole buckets by `bucket`-start), which made the same chart
 * request return different averages depending solely on whether the aggregate was available — and
 * the `.catch` fallback to raw made it nondeterministic. Gating on alignment makes cagg and raw
 * identical wherever cagg is used (so the fallback is safe too), at the cost of serving unaligned
 * windows from raw. Callers wanting the aggregate's speed should request grid-aligned ranges.
 */
export function isCaggEligible(from: Date, to: Date, bucket: string): boolean {
  const bs = bucketSeconds(bucket);
  const gridMs = CAGG_BUCKET_SECONDS * 1000;
  return (
    bs >= CAGG_BUCKET_SECONDS &&
    bs % CAGG_BUCKET_SECONDS === 0 &&
    from.getTime() % gridMs === 0 &&
    to.getTime() % gridMs === 0
  );
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
    ts?: Date;
  }): Promise<unknown> {
    return this.prisma.$executeRaw`INSERT INTO "DeviceStatusEvent" ("time","organizationId","deviceId","state","source")
      VALUES (${d.ts ?? new Date()}, ${d.organizationId}, ${d.deviceId}, ${d.state}, ${d.source})`;
  }

  /** Bulk variant of insertMetric — one multi-row INSERT for an entire ingest batch. */
  insertMetrics(
    rows: { organizationId: string; deviceId: string; metric: string; value: number; source: string; ts?: Date }[],
  ): Promise<unknown> {
    if (rows.length === 0) return Promise.resolve(0);
    const now = new Date();
    const values = rows.map(
      (r) => Prisma.sql`(${r.ts ?? now}, ${r.organizationId}, ${r.deviceId}, ${r.metric}, ${r.value}, ${r.source})`,
    );
    return this.prisma
      .$executeRaw`INSERT INTO "MonitoringMetric" ("time","organizationId","deviceId","metric","value","source") VALUES ${Prisma.join(values)}`;
  }

  /** Bulk variant of insertStatusEvent — one multi-row INSERT for all transitions in a batch. */
  insertStatusEvents(
    rows: { organizationId: string; deviceId: string; state: DeviceStatusState; source: string }[],
  ): Promise<unknown> {
    if (rows.length === 0) return Promise.resolve(0);
    const now = new Date();
    const values = rows.map(
      (r) => Prisma.sql`(${now}, ${r.organizationId}, ${r.deviceId}, ${r.state}, ${r.source})`,
    );
    return this.prisma
      .$executeRaw`INSERT INTO "DeviceStatusEvent" ("time","organizationId","deviceId","state","source") VALUES ${Prisma.join(values)}`;
  }

  async metricNames(organizationId: string, deviceId: string, since: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ metric: string }[]>`
      SELECT DISTINCT "metric" FROM "MonitoringMetric"
      WHERE "organizationId" = ${organizationId} AND "deviceId" = ${deviceId} AND "time" >= ${since}
      ORDER BY "metric"`;
    return rows.map((r) => r.metric);
  }

  async recentStatusEvents(
    organizationId: string,
    deviceId: string,
    limit: number,
  ): Promise<{ time: Date; state: DeviceStatusState; source: string }[]> {
    return this.prisma.$queryRaw<{ time: Date; state: DeviceStatusState; source: string }[]>`
      SELECT "time", "state", "source" FROM "DeviceStatusEvent"
      WHERE "organizationId" = ${organizationId} AND "deviceId" = ${deviceId}
      ORDER BY "time" DESC LIMIT ${limit}`;
  }

  queryMetric(
    organizationId: string,
    deviceId: string,
    metric: string,
    from: Date,
    to: Date,
    bucket: string,
  ): Promise<{ bucket: Date; avg: number }[]> {
    // Read the pre-aggregated 5-min rollup (re-bucketed) instead of scanning the raw hypertable
    // ONLY when the window is grid-aligned, so the rollup reproduces the raw result exactly (see
    // isCaggEligible). Fall back to raw if the aggregate is unavailable — safe here because, for an
    // aligned window, raw and cagg are identical. Unaligned windows (and sub-5-min buckets) use raw.
    if (isCaggEligible(from, to, bucket)) {
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
