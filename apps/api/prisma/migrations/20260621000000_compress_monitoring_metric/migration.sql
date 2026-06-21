-- Compress the high-volume Spec 7 "MonitoringMetric" hypertable.
--
-- It was the only monitoring hypertable left uncompressed (the legacy "DeviceMetric"
-- series is compressed by TimescaleService; DeviceStatusEvent is low-volume). With >=2
-- rows per device per probe cycle, MonitoringMetric is the busiest write target, so
-- enabling compression is a large storage win (typically ~8-20x) and makes historical
-- range scans much cheaper.
--
-- Segment by deviceId so it matches the (deviceId, metric, time DESC) read pattern, and
-- order compressed rows by time so range scans stay efficient. Compress chunks older than
-- 7 days; the 90-day retention policy is unchanged.
-- Identifiers must be quoted inside the option strings or TimescaleDB folds them to
-- lower-case (the columns were created as mixed-case "deviceId" / "time").
ALTER TABLE "MonitoringMetric" SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = '"deviceId"',
  timescaledb.compress_orderby = '"time" DESC'
);

SELECT add_compression_policy('"MonitoringMetric"', INTERVAL '7 days', if_not_exists => TRUE);

-- 90-day retention over the default ~7-day chunks makes oversized chunks; 1-day chunks
-- compress and drop more granularly. Only affects chunks created after this runs.
SELECT set_chunk_time_interval('"MonitoringMetric"', INTERVAL '1 day');
