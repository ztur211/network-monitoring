-- CreateEnum
CREATE TYPE "DeviceMobility" AS ENUM ('HOME_ONLY', 'ROAMS', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "DeviceCategory" ADD VALUE 'BROWSER_CLIENT';

-- AlterTable
-- NOTE: we explicitly do NOT touch the PostGIS "location" geometry column or
-- the "device_location_idx" GIST index here. They are managed by raw SQL in
-- the init migration and are intentionally invisible to Prisma's schema diff.
ALTER TABLE "Device"
    ADD COLUMN "browserDeviceId" TEXT,
    ADD COLUMN "mobility" "DeviceMobility" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "networkId" TEXT;

-- AlterTable
ALTER TABLE "DeviceMetric"
    ADD COLUMN "deviceId" TEXT,
    ADD COLUMN "tag" TEXT;

-- CreateTable
CREATE TABLE "Network" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "homeAddress" TEXT,
    "homeLatitude" DOUBLE PRECISION,
    "homeLongitude" DOUBLE PRECISION,
    "homePublicIp" TEXT,
    "isp" TEXT,
    "downMbps" DOUBLE PRECISION,
    "upMbps" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Network_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Network_userId_idx" ON "Network"("userId");

-- CreateIndex
CREATE INDEX "Device_userId_networkId_idx" ON "Device"("userId", "networkId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_browserDeviceId_key" ON "Device"("userId", "browserDeviceId");

-- CreateIndex
CREATE INDEX "DeviceMetric_userId_deviceId_time_idx" ON "DeviceMetric"("userId", "deviceId", "time" DESC);

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_networkId_fkey"
    FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Network" ADD CONSTRAINT "Network_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
