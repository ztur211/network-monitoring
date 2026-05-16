-- PostGIS extension (must precede any geometry references)
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "AccountTier" AS ENUM ('PERSONAL_FREE', 'PERSONAL_PAID', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "DeviceCategory" AS ENUM (
    'RAD',
    'ONT',
    'DSLAM',
    'ROUTER',
    'MODEM',
    'FIBER_MEDIA_CONVERTER',
    'FIREWALL',
    'SWITCH',
    'ACCESS_POINT',
    'WIFI_EXTENDER',
    'WIRELESS_BRIDGE',
    'SERVER_RACK',
    'PATCH_PANEL',
    'UPS',
    'COMPUTER',
    'PHONE',
    'TABLET',
    'PRINTER',
    'IOT_DEVICE',
    'CUSTOM'
);

-- CreateEnum
CREATE TYPE "ConnectionType" AS ENUM ('ETHERNET', 'FIBER', 'WIFI', 'LOGICAL');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "image" TEXT,
    "tier" "AccountTier" NOT NULL DEFAULT 'PERSONAL_FREE',
    "homeLatitude" DOUBLE PRECISION,
    "homeLongitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "DeviceCategory" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "floor" INTEGER,
    "floorLabel" TEXT,
    "ipAddress" TEXT,
    "macAddress" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- PostGIS geometry column for Device.location (kept in sync via trigger below).
-- Prisma does not natively manage PostGIS geometry types; the column is invisible
-- to Prisma queries and is read via raw $queryRaw in MapRepository.
ALTER TABLE "Device" ADD COLUMN "location" geometry(Point, 4326);
CREATE INDEX "device_location_idx" ON "Device" USING GIST ("location");

CREATE OR REPLACE FUNCTION sync_device_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    ELSE
        NEW.location = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_location_sync
    BEFORE INSERT OR UPDATE ON "Device"
    FOR EACH ROW EXECUTE FUNCTION sync_device_location();

-- CreateTable
CREATE TABLE "DeviceConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceDeviceId" TEXT NOT NULL,
    "targetDeviceId" TEXT NOT NULL,
    "connectionType" "ConnectionType" NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiberRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDeviceId" TEXT NOT NULL,
    "endDeviceId" TEXT NOT NULL,
    "cableType" TEXT,
    "lengthMeters" DOUBLE PRECISION,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiberRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Circuit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ispName" TEXT NOT NULL,
    "circuitId" TEXT,
    "serviceType" TEXT NOT NULL,
    "bandwidth" DOUBLE PRECISION,
    "deviceId" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Circuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- DeviceMetric is converted to a TimescaleDB hypertable at API startup
-- (apps/api/src/timescale/timescale.service.ts) — Prisma manages the table shape
-- only, never the hypertable, compression, or retention policies.
CREATE TABLE "DeviceMetric" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "bandwidthDown" DOUBLE PRECISION,
    "bandwidthUp" DOUBLE PRECISION,
    "latency" DOUBLE PRECISION,
    "connectionQuality" TEXT,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- ChangeLog entityType is a polymorphic discriminator; FK constraints would
-- cascade-delete the audit trail when an entity is removed, defeating its purpose.
-- A check constraint validates the value instead. Update this list when new
-- entity types are added post-MVP.
ALTER TABLE "ChangeLog"
    ADD CONSTRAINT "changelog_entity_type_check"
    CHECK ("entityType" IN ('Device', 'Circuit', 'FiberRun', 'DeviceConnection'));

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "Device_userId_category_idx" ON "Device"("userId", "category");

-- CreateIndex
CREATE INDEX "Device_userId_floor_idx" ON "Device"("userId", "floor");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_name_key" ON "Device"("userId", "name");

-- CreateIndex
CREATE INDEX "DeviceConnection_userId_sourceDeviceId_idx" ON "DeviceConnection"("userId", "sourceDeviceId");

-- CreateIndex
CREATE INDEX "DeviceConnection_userId_targetDeviceId_idx" ON "DeviceConnection"("userId", "targetDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceConnection_userId_sourceDeviceId_targetDeviceId_conne_key"
    ON "DeviceConnection"("userId", "sourceDeviceId", "targetDeviceId", "connectionType");

-- CreateIndex
CREATE INDEX "FiberRun_userId_idx" ON "FiberRun"("userId");

-- CreateIndex
CREATE INDEX "FiberRun_userId_startDeviceId_idx" ON "FiberRun"("userId", "startDeviceId");

-- CreateIndex
CREATE INDEX "FiberRun_userId_endDeviceId_idx" ON "FiberRun"("userId", "endDeviceId");

-- CreateIndex
CREATE INDEX "Circuit_userId_idx" ON "Circuit"("userId");

-- CreateIndex
CREATE INDEX "Circuit_userId_deviceId_idx" ON "Circuit"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "DeviceMetric_userId_time_idx" ON "DeviceMetric"("userId", "time" DESC);

-- CreateIndex
CREATE INDEX "DeviceMetric_userId_sourceType_time_idx" ON "DeviceMetric"("userId", "sourceType", "time" DESC);

-- CreateIndex
CREATE INDEX "ChangeLog_userId_entityType_entityId_idx" ON "ChangeLog"("userId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "ChangeLog_userId_createdAt_idx" ON "ChangeLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ChangeLog_entityId_idx" ON "ChangeLog"("entityId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_sourceDeviceId_fkey"
    FOREIGN KEY ("sourceDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_targetDeviceId_fkey"
    FOREIGN KEY ("targetDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberRun" ADD CONSTRAINT "FiberRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberRun" ADD CONSTRAINT "FiberRun_startDeviceId_fkey"
    FOREIGN KEY ("startDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberRun" ADD CONSTRAINT "FiberRun_endDeviceId_fkey"
    FOREIGN KEY ("endDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
