-- F2 Phase B: Retire BROWSER_CLIENT, make Device a Network×Property junction,
-- drop Network.propertyId (was reserved post-MVP placeholder), add NetworkProperty
-- charter table.
--
-- This migration is always applied after a greenfield reset (no real data) so
-- there is no backfill concern for the new NOT NULL columns on Device.
-- The PostGIS geometry column (location / device_location_idx) is intentionally
-- NOT touched — it is managed by raw SQL in the init migration and is invisible
-- to Prisma's schema diff.

-- ─── Step 1: Retire BROWSER_CLIENT from DeviceCategory enum ─────────────────
-- PostgreSQL does not support DROP VALUE on an enum. Instead we create a new
-- enum without BROWSER_CLIENT and swap the column type.

-- Create replacement enum
CREATE TYPE "DeviceCategory_new" AS ENUM (
  'RAD', 'ONT', 'DSLAM',
  'ROUTER', 'MODEM', 'FIBER_MEDIA_CONVERTER', 'FIREWALL',
  'SWITCH', 'ACCESS_POINT', 'WIFI_EXTENDER', 'WIRELESS_BRIDGE',
  'SERVER_RACK', 'PATCH_PANEL', 'UPS',
  'COMPUTER', 'PHONE', 'TABLET', 'PRINTER', 'IOT_DEVICE',
  'CUSTOM'
);

-- Migrate column to new enum (BROWSER_CLIENT values must not exist — greenfield)
ALTER TABLE "Device" ALTER COLUMN "category" TYPE "DeviceCategory_new"
  USING "category"::text::"DeviceCategory_new";

-- Swap enum names
DROP TYPE "DeviceCategory";
ALTER TYPE "DeviceCategory_new" RENAME TO "DeviceCategory";

-- ─── Step 2: Remove browserDeviceId from Device ──────────────────────────────

DROP INDEX "Device_organizationId_browserDeviceId_key";
ALTER TABLE "Device" DROP COLUMN "browserDeviceId";

-- ─── Step 3: Drop Network.propertyId (reserved post-MVP placeholder) ─────────

DROP INDEX "Network_organizationId_propertyId_idx";
ALTER TABLE "Network" DROP COLUMN "propertyId";

-- ─── Step 4: Re-attach Device — make networkId NOT NULL, add propertyId + roleCode ─

-- 4a. Drop the nullable FK constraint for networkId (was SET NULL)
ALTER TABLE "Device" DROP CONSTRAINT "Device_networkId_fkey";

-- 4b. Make networkId NOT NULL (no existing rows in greenfield reset)
ALTER TABLE "Device" ALTER COLUMN "networkId" SET NOT NULL;

-- 4c. Re-add networkId FK with Restrict semantics
ALTER TABLE "Device" ADD CONSTRAINT "Device_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4d. Add propertyId (NOT NULL — greenfield, no backfill needed)
ALTER TABLE "Device" ADD COLUMN "propertyId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Device" ALTER COLUMN "propertyId" DROP DEFAULT;

-- 4e. Add roleCode (nullable)
ALTER TABLE "Device" ADD COLUMN "roleCode" TEXT;

-- 4f. Add FK for propertyId with Restrict semantics
ALTER TABLE "Device" ADD CONSTRAINT "Device_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4g. Add new index on (organizationId, propertyId)
CREATE INDEX "Device_organizationId_propertyId_idx" ON "Device"("organizationId", "propertyId");

-- ─── Step 5: Create NetworkProperty table ────────────────────────────────────

CREATE TABLE "NetworkProperty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkProperty_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetworkProperty_networkId_propertyId_key" ON "NetworkProperty"("networkId", "propertyId");
CREATE INDEX "NetworkProperty_organizationId_idx" ON "NetworkProperty"("organizationId");
CREATE INDEX "NetworkProperty_propertyId_idx" ON "NetworkProperty"("propertyId");

ALTER TABLE "NetworkProperty" ADD CONSTRAINT "NetworkProperty_networkId_fkey"
  FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NetworkProperty" ADD CONSTRAINT "NetworkProperty_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NetworkProperty" ADD CONSTRAINT "NetworkProperty_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
