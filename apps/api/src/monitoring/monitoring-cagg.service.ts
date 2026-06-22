import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Creates the 5-minute continuous aggregate over MonitoringMetric (+ its refresh policy)
 * idempotently at boot. Continuous aggregates cannot be created inside a transaction, so —
 * unlike the rest of the TimescaleDB setup, which now lives in migrations — this must run as
 * autocommit DDL at boot rather than in a Prisma migration.
 *
 * MonitoringRepository.queryMetric reads from this aggregate for chart buckets >= 5 min
 * (re-bucketing the pre-aggregated sums), falling back to the raw hypertable otherwise.
 */
@Injectable()
export class MonitoringCaggService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringCaggService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        -- materialized_only=false enables real-time aggregation: rows newer than the last
        -- refresh are unioned from the raw hypertable, so charts include the latest data
        -- immediately (without it, a freshly-created/unrefreshed aggregate returns nothing).
        CREATE MATERIALIZED VIEW IF NOT EXISTS "MonitoringMetric_5m"
        WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT time_bucket('5 minutes', "time") AS bucket,
               "organizationId", "deviceId", "metric",
               sum("value") AS sum_value, count(*) AS sample_count
        FROM "MonitoringMetric"
        GROUP BY 1, 2, 3, 4
        WITH NO DATA
      `);
      await this.prisma.$executeRawUnsafe(`
        SELECT add_continuous_aggregate_policy('"MonitoringMetric_5m"',
          start_offset => INTERVAL '1 day', end_offset => INTERVAL '5 minutes',
          schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE)
      `);
      this.logger.log('MonitoringMetric_5m continuous aggregate ready');
    } catch (error) {
      // Non-fatal: queryMetric falls back to the raw hypertable if the aggregate is absent.
      this.logger.warn({ error }, 'Failed to set up MonitoringMetric continuous aggregate — charts use raw');
    }
  }
}
