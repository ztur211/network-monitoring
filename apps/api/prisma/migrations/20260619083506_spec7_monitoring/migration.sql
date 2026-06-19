-- CreateEnum
CREATE TYPE "DeviceStatusState" AS ENUM ('UP', 'DOWN', 'WARNING', 'UNKNOWN');

-- NOTE: Prisma emits `DROP INDEX "device_location_idx";` here because it does not
-- model the PostGIS GIST index on Device.location (an Unsupported() column). That
-- index is managed by raw SQL (see 20260516000000_init) and must be preserved, so
-- the spurious drop is intentionally removed (same convention as prior migrations).

-- CreateTable
CREATE TABLE "DeviceStatus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "state" "DeviceStatusState" NOT NULL DEFAULT 'UNKNOWN',
    "latencyMs" DOUBLE PRECISION,
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "lastCheckAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastChangeAt" TIMESTAMP(3),
    "source" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringIngestToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringIngestToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceStatus_deviceId_key" ON "DeviceStatus"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceStatus_organizationId_idx" ON "DeviceStatus"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringIngestToken_organizationId_key" ON "MonitoringIngestToken"("organizationId");

-- AddForeignKey
ALTER TABLE "DeviceStatus" ADD CONSTRAINT "DeviceStatus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceStatus" ADD CONSTRAINT "DeviceStatus_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringIngestToken" ADD CONSTRAINT "MonitoringIngestToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── TimescaleDB hypertables (Spec 7) ────────────────────────────────────────
-- DeviceMetric / DeviceStatusEvent are raw-SQL Timescale hypertables, NOT Prisma
-- models: queried via $queryRaw/$executeRaw. The extension is also created at API
-- startup (TimescaleService) but creating it here keeps the migration self-sufficient.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Generic per-device monitoring metric time-series (v1 writes latency_ms + reachable;
-- the Agent pushes arbitrary metrics with no server change).
-- NOTE: named "MonitoringMetric" (NOT "DeviceMetric") — the legacy 2D app already owns
-- a "DeviceMetric" hypertable (userId/sourceType/bandwidth/connectionQuality, managed by
-- TimescaleService). Spec 7's generic health-metric series is a distinct concern, so it
-- gets its own table rather than overloading the legacy schema.
CREATE TABLE "MonitoringMetric" (
  "time"           TIMESTAMPTZ      NOT NULL,
  "organizationId" TEXT             NOT NULL,
  "deviceId"       TEXT             NOT NULL,
  "metric"         TEXT             NOT NULL,
  "value"          DOUBLE PRECISION NOT NULL,
  "source"         TEXT
);
SELECT create_hypertable('"MonitoringMetric"', 'time');
CREATE INDEX "monitoring_metric_dev_metric_time" ON "MonitoringMetric" ("deviceId", "metric", "time" DESC);
SELECT add_retention_policy('"MonitoringMetric"', INTERVAL '90 days');

-- State-transition timeline (written only on change → low volume).
CREATE TABLE "DeviceStatusEvent" (
  "time"           TIMESTAMPTZ NOT NULL,
  "organizationId" TEXT        NOT NULL,
  "deviceId"       TEXT        NOT NULL,
  "state"          TEXT        NOT NULL,
  "source"         TEXT
);
SELECT create_hypertable('"DeviceStatusEvent"', 'time');
CREATE INDEX "device_status_event_dev_time" ON "DeviceStatusEvent" ("deviceId", "time" DESC);
SELECT add_retention_policy('"DeviceStatusEvent"', INTERVAL '365 days');

-- Extend the ChangeLog entityType CHECK with 'MonitoringIngestToken' (token
-- (re)generation is audited). Superset of the current list; do NOT drop any.
ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "changelog_entity_type_check";
ALTER TABLE "ChangeLog" ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device','Circuit','FiberRun','DeviceConnection','Network','Property','NetworkProperty',
                          'Team','TeamMember','TeamProperty','MemberProperty',
                          'BuildingModel','BuildingModelVersion',
                          'MonitoringIngestToken'));
