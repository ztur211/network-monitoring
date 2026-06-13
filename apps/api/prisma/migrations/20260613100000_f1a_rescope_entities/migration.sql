-- F1a Phase B: Re-scope entities from userId-owned to organizationId-owned.
-- userId becomes a nullable creator field (SET NULL on User delete) on all 5
-- entity tables. DeviceMetric gets organizationId as a plain column (no FK —
-- consistent with existing userId plain-column pattern on that hypertable).

-- ─── Device ───────────────────────────────────────────────────────────────────

-- Drop old userId-based constraints and indexes
ALTER TABLE "Device" DROP CONSTRAINT "Device_userId_fkey";
DROP INDEX "Device_userId_name_key";
DROP INDEX "Device_userId_browserDeviceId_key";
DROP INDEX "Device_userId_idx";
DROP INDEX "Device_userId_category_idx";
DROP INDEX "Device_userId_floor_idx";
DROP INDEX "Device_userId_networkId_idx";

-- Add organizationId column (temporarily nullable so existing rows survive)
ALTER TABLE "Device" ADD COLUMN "organizationId" TEXT;

-- Make userId nullable
ALTER TABLE "Device" ALTER COLUMN "userId" DROP NOT NULL;

-- Backfill organizationId (migration always applied after a --skip-seed reset,
-- so no real rows; backfill is a safety net for non-zero-row scenarios)
UPDATE "Device" SET "organizationId" = '' WHERE "organizationId" IS NULL;
ALTER TABLE "Device" ALTER COLUMN "organizationId" SET NOT NULL;

-- Add FK for organizationId
ALTER TABLE "Device" ADD CONSTRAINT "Device_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Re-add userId FK as SET NULL
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New indexes
CREATE UNIQUE INDEX "Device_organizationId_browserDeviceId_key" ON "Device"("organizationId", "browserDeviceId");
CREATE INDEX "Device_organizationId_idx" ON "Device"("organizationId");
CREATE INDEX "Device_organizationId_category_idx" ON "Device"("organizationId", "category");
CREATE INDEX "Device_organizationId_floor_idx" ON "Device"("organizationId", "floor");
CREATE INDEX "Device_organizationId_networkId_idx" ON "Device"("organizationId", "networkId");

-- ─── Network ──────────────────────────────────────────────────────────────────

ALTER TABLE "Network" DROP CONSTRAINT "Network_userId_fkey";
DROP INDEX "Network_userId_idx";
DROP INDEX "Network_userId_propertyId_idx";

ALTER TABLE "Network" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Network" ALTER COLUMN "userId" DROP NOT NULL;

UPDATE "Network" SET "organizationId" = '' WHERE "organizationId" IS NULL;
ALTER TABLE "Network" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Network" ADD CONSTRAINT "Network_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Network" ADD CONSTRAINT "Network_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Network_organizationId_idx" ON "Network"("organizationId");
CREATE INDEX "Network_organizationId_propertyId_idx" ON "Network"("organizationId", "propertyId");

-- ─── DeviceConnection ─────────────────────────────────────────────────────────

ALTER TABLE "DeviceConnection" DROP CONSTRAINT "DeviceConnection_userId_fkey";
DROP INDEX "DeviceConnection_userId_sourceDeviceId_targetDeviceId_conne_key";
DROP INDEX "DeviceConnection_userId_sourceDeviceId_idx";
DROP INDEX "DeviceConnection_userId_targetDeviceId_idx";

ALTER TABLE "DeviceConnection" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "DeviceConnection" ALTER COLUMN "userId" DROP NOT NULL;

UPDATE "DeviceConnection" SET "organizationId" = '' WHERE "organizationId" IS NULL;
ALTER TABLE "DeviceConnection" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- NB: index name is Prisma's 63-char truncation of
-- DeviceConnection_organizationId_sourceDeviceId_targetDeviceId_connectionType_key,
-- which differs from Postgres's naive truncation — must match Prisma to avoid drift.
CREATE UNIQUE INDEX "DeviceConnection_organizationId_sourceDeviceId_targetDevice_key"
  ON "DeviceConnection"("organizationId", "sourceDeviceId", "targetDeviceId", "connectionType");
CREATE INDEX "DeviceConnection_organizationId_sourceDeviceId_idx" ON "DeviceConnection"("organizationId", "sourceDeviceId");
CREATE INDEX "DeviceConnection_organizationId_targetDeviceId_idx" ON "DeviceConnection"("organizationId", "targetDeviceId");

-- ─── FiberRun ─────────────────────────────────────────────────────────────────

ALTER TABLE "FiberRun" DROP CONSTRAINT "FiberRun_userId_fkey";
DROP INDEX "FiberRun_userId_idx";
DROP INDEX "FiberRun_userId_startDeviceId_idx";
DROP INDEX "FiberRun_userId_endDeviceId_idx";

ALTER TABLE "FiberRun" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "FiberRun" ALTER COLUMN "userId" DROP NOT NULL;

UPDATE "FiberRun" SET "organizationId" = '' WHERE "organizationId" IS NULL;
ALTER TABLE "FiberRun" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "FiberRun" ADD CONSTRAINT "FiberRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FiberRun" ADD CONSTRAINT "FiberRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FiberRun_organizationId_idx" ON "FiberRun"("organizationId");
CREATE INDEX "FiberRun_organizationId_startDeviceId_idx" ON "FiberRun"("organizationId", "startDeviceId");
CREATE INDEX "FiberRun_organizationId_endDeviceId_idx" ON "FiberRun"("organizationId", "endDeviceId");

-- ─── Circuit ──────────────────────────────────────────────────────────────────

ALTER TABLE "Circuit" DROP CONSTRAINT "Circuit_userId_fkey";
DROP INDEX "Circuit_userId_idx";
DROP INDEX "Circuit_userId_deviceId_idx";

ALTER TABLE "Circuit" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Circuit" ALTER COLUMN "userId" DROP NOT NULL;

UPDATE "Circuit" SET "organizationId" = '' WHERE "organizationId" IS NULL;
ALTER TABLE "Circuit" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Circuit_organizationId_idx" ON "Circuit"("organizationId");
CREATE INDEX "Circuit_organizationId_deviceId_idx" ON "Circuit"("organizationId", "deviceId");

-- ─── DeviceMetric (hypertable — plain column, no FK relation) ─────────────────

DROP INDEX "DeviceMetric_userId_time_idx";
DROP INDEX "DeviceMetric_userId_sourceType_time_idx";
DROP INDEX "DeviceMetric_userId_deviceId_time_idx";

-- Add organizationId with a default so TimescaleDB chunks aren't upset;
-- drop the default immediately after so future inserts must supply the value.
ALTER TABLE "DeviceMetric" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DeviceMetric" ALTER COLUMN "organizationId" DROP DEFAULT;

CREATE INDEX "DeviceMetric_organizationId_time_idx" ON "DeviceMetric"("organizationId", "time" DESC);
CREATE INDEX "DeviceMetric_organizationId_sourceType_time_idx" ON "DeviceMetric"("organizationId", "sourceType", "time" DESC);
CREATE INDEX "DeviceMetric_organizationId_deviceId_time_idx" ON "DeviceMetric"("organizationId", "deviceId", "time" DESC);

-- ─── Case-insensitive org-scoped device name uniqueness ───────────────────────
-- (raw SQL; Prisma can't express lower())
CREATE UNIQUE INDEX "device_org_name_lower_uniq" ON "Device" ("organizationId", lower("name"));
