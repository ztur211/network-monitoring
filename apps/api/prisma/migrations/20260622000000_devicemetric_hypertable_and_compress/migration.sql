-- Move the DeviceMetric hypertable + compression + retention setup out of TimescaleService
-- (boot-time DDL) and into a migration, matching the spec7 MonitoringMetric pattern so all
-- TimescaleDB setup is versioned + applied by `migrate deploy` rather than at app startup.
--
-- This also FIXES a latent bug: the boot code used `compress_segmentby = 'userId'`, which
-- TimescaleDB folds to lowercase `userid` (a nonexistent column), so the compression ALTER
-- silently failed under its warn-catch on every boot — DeviceMetric was never compressed.
-- Quoting the identifier ('"userId"') preserves the case.
--
-- Idempotent on existing DBs: the hypertable + retention policy were already created at boot
-- (no-ops via if_not_exists); the ALTER enables compression for the first time, and the
-- compression policy is added now that the columnstore is enabled.

CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable('"DeviceMetric"', 'time',
  chunk_time_interval => INTERVAL '1 week',
  if_not_exists => TRUE);

ALTER TABLE "DeviceMetric" SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = '"userId"'
);

SELECT add_compression_policy('"DeviceMetric"', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('"DeviceMetric"', INTERVAL '30 days', if_not_exists => TRUE);
