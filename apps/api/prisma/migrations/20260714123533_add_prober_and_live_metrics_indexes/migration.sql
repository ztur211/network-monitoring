-- Two indexes for the two unindexed hot queries.
--
-- Device(ipAddress): the embedded prober selects every probeable device across ALL orgs on every
-- tick, so it is the one hot query that is deliberately not org-scoped and could not use any of
-- the existing (organizationId, ...) indexes. It was a full sequential scan of Device every
-- MONITORING_PROBE_INTERVAL_MS.
--
-- DeviceMetric(organizationId, userId, time DESC): the live-metrics push runs
-- SELECT DISTINCT ON ("userId") ... ORDER BY "userId", time DESC once per org, every
-- REFRESH_INTERVAL_SECONDS. No index carried userId, so it was a scan-and-sort over the org's
-- whole 30-day retention on each tick. The column order and DESC match the query's sort exactly,
-- so it can walk straight to the newest row per user.
--
-- NOTE for whoever regenerates a migration here: `prisma migrate dev` wants to DROP the
-- DeviceStatusEvent and MonitoringMetric tables and the device_location_idx / DeviceMetric_time_idx
-- indexes, because those objects are created by raw SQL in earlier migrations and are not modeled
-- in schema.prisma. Those DROPs are drift artifacts, NOT intended changes, and applying them
-- destroys monitoring data. This migration was hand-trimmed to the two CREATE INDEX statements.

-- CreateIndex
CREATE INDEX "Device_ipAddress_idx" ON "Device"("ipAddress");

-- CreateIndex
CREATE INDEX "DeviceMetric_organizationId_userId_time_idx" ON "DeviceMetric"("organizationId", "userId", "time" DESC);
