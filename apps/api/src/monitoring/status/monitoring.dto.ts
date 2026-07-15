import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query validation for GET /v1/devices/:id/metrics.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 * The endpoint used to take `metric`, `from`, `to` and `bucket` as raw @Query strings and pass
 * them straight into a LIMIT-less `GROUP BY time_bucket(...)`. The query returns one row per
 * OCCUPIED bucket, so the row count of a single request is bounded only by the retention window
 * (90 days for MonitoringMetric) divided by the bucket width. At the default 30 s probe cadence
 * that is ~260 000 rows for ONE device with `bucket=1 second`, all materialized into API memory
 * by the driver before anything is streamed out - a handful of concurrent requests OOMs the API
 * container. `new Date('garbage')` also produced an Invalid Date that blew up in the driver as a
 * 500, and made `isCaggEligible` silently answer false on NaN.
 *
 * The values are NOT a SQL-injection vector: the repository builds both statements with Prisma's
 * `$queryRaw` TAGGED TEMPLATE, so every interpolation - `bucket` included, via `$1::interval` -
 * is bound as a parameter, never spliced into SQL text. Verified against the test database: a
 * `bucket` of `1 second'); DROP TABLE ...; --` arrives at Postgres as a parameter VALUE. The
 * allow-list below is therefore about bounding WORK, not about escaping.
 */

/**
 * Bucket widths the chart endpoint may aggregate by - an allow-list, not free text, because this
 * value is what divides the window into rows.
 *
 * Chosen from what the product actually charts:
 *  - `30 seconds` is the finest granularity that is meaningful at all: it matches the default
 *    embedded-prober cadence (MONITORING_PROBE_INTERVAL_MS = 30 000), so a finer bucket cannot
 *    reveal any additional sample, it can only multiply empty buckets.
 *  - `5 minutes` is the only value any shipped client sends (the default in
 *    packages/client's getDeviceMetrics; apps/desktop never overrides it) and matches the
 *    MonitoringMetric_5m continuous aggregate's granularity.
 *  - the rest are the coarser steps a 1 h / 1 d / 1 w / 90 d chart needs. Every entry except
 *    `30 seconds` and `1 minute` is a whole multiple of 5 minutes, so it stays eligible for the
 *    continuous aggregate (see isCaggEligible).
 *
 * Every entry must be parseable by `bucketSeconds()` in monitoring.repository.ts.
 */
export const METRIC_BUCKETS = [
  '30 seconds',
  '1 minute',
  '5 minutes',
  '15 minutes',
  '1 hour',
  '6 hours',
  '1 day',
] as const;

export type MetricBucket = (typeof METRIC_BUCKETS)[number];

/** What packages/client already defaults to, so an omitted `bucket` keeps behaving as before. */
export const DEFAULT_METRIC_BUCKET: MetricBucket = '5 minutes';

/** Window used when `from`/`to` are omitted - matches apps/desktop's telemetry panel (1 h). */
export const DEFAULT_METRIC_WINDOW_MS = 3600_000;

/**
 * Hard cap on `(to - from) / bucket`, i.e. on the number of rows a request can ask the database
 * to produce. This - not the span alone - is what bounds memory: 90 days of `1 hour` buckets is a
 * legitimate 2 161-point chart, while 2 days of `30 seconds` buckets is 5 760 points nobody can
 * read on a screen 2 560 pixels wide. 5 000 leaves headroom over every chart the product draws
 * (full-retention hourly = 2 161; a week at 5 min = 2 017) while keeping the worst-case response a
 * few hundred kB rather than tens of MB.
 */
export const MAX_METRIC_BUCKETS = 5_000;

/**
 * Mirrors MAX_METRIC_NAME_LENGTH in ingest/ingest.dto.ts - the write side's cap on a metric name,
 * so anything that could have been INGESTED can still be READ back.
 *
 * Deliberately a bound and NOT an @IsIn allow-list: metric names are open-ended by design. Beyond
 * the fixed `latency_ms` / `reachable` / `sys_uptime`, the SNMP collector emits one metric PER
 * INTERFACE (`if_hc_in_octets.<ifIndex>`, ...) and one per entry in the org's OID profile, whose
 * `metric` label is free text the org chooses (snmp.dto.ts). apps/desktop populates its metric
 * picker from GET /metric-names - the distinct names actually present for that device - so an
 * allow-list here would 400 exactly the metrics the UI just offered. The name is bound as a SQL
 * parameter, so an unknown name is simply an empty series, not a risk.
 */
export const MAX_METRIC_NAME_LENGTH = 64;

export class DeviceMetricsQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_METRIC_NAME_LENGTH)
  metric!: string;

  /** ISO-8601. Absent → `to` - DEFAULT_METRIC_WINDOW_MS. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** ISO-8601. Absent → now. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Absent → DEFAULT_METRIC_BUCKET. */
  @IsOptional()
  @IsIn(METRIC_BUCKETS)
  bucket?: MetricBucket;
}
