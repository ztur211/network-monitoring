-- NOTE: Prisma emits spurious DROP TABLE for "DeviceStatusEvent" and "MonitoringMetric"
-- (raw-SQL TimescaleDB hypertables from spec7, not Prisma models) and DROP INDEX for
-- "device_location_idx" and "DeviceMetric_time_idx" (raw-SQL PostGIS/Timescale indexes).
-- All are intentionally removed here; same convention established in
-- 20260619083506_spec7_monitoring / 20260619173426_spec9_snmp / 20260619201041_spec6_bcf.

-- CreateEnum
CREATE TYPE "AlertChannelType" AS ENUM ('WEBHOOK', 'EMAIL', 'INAPP');

-- CreateEnum
CREATE TYPE "AlertTrigger" AS ENUM ('STATE_TRANSITION', 'METRIC_THRESHOLD');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertEventKind" AS ENUM ('FIRING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AlertDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'GAVE_UP');

-- CreateTable
CREATE TABLE "AlertChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "AlertChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretEnc" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "AlertTrigger" NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{"all":true}',
    "targetStates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metric" TEXT,
    "op" TEXT,
    "threshold" DOUBLE PRECISION,
    "forSeconds" INTEGER,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 300,
    "notifyOnRecovery" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "deviceId" TEXT,
    "kind" "AlertEventKind" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "dedupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "alertEventId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "AlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertChannel_organizationId_idx" ON "AlertChannel"("organizationId");

-- CreateIndex
CREATE INDEX "AlertRule_organizationId_idx" ON "AlertRule"("organizationId");

-- CreateIndex
CREATE INDEX "AlertRule_trigger_enabled_idx" ON "AlertRule"("trigger", "enabled");

-- CreateIndex
CREATE INDEX "AlertEvent_organizationId_createdAt_idx" ON "AlertEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertEvent_dedupKey_createdAt_idx" ON "AlertEvent"("dedupKey", "createdAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_status_nextAttemptAt_idx" ON "AlertDelivery"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "AlertChannel" ADD CONSTRAINT "AlertChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_alertEventId_fkey" FOREIGN KEY ("alertEventId") REFERENCES "AlertEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
