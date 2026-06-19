-- NOTE: Prisma emits spurious DROP TABLE for "DeviceStatusEvent" and "MonitoringMetric"
-- (raw-SQL TimescaleDB hypertables from spec7, not Prisma models) and DROP INDEX for
-- "device_location_idx" (raw-SQL PostGIS GIST index). All three are intentionally removed
-- here; same convention established in 20260619083506_spec7_monitoring.

-- CreateEnum
CREATE TYPE "SnmpVersion" AS ENUM ('V2C', 'V3');

-- CreateEnum
CREATE TYPE "SnmpSecurityLevel" AS ENUM ('NO_AUTH_NO_PRIV', 'AUTH_NO_PRIV', 'AUTH_PRIV');

-- CreateEnum
CREATE TYPE "SnmpAuthProtocol" AS ENUM ('MD5', 'SHA', 'SHA256');

-- CreateEnum
CREATE TYPE "SnmpPrivProtocol" AS ENUM ('DES', 'AES', 'AES256');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "oidProfileId" TEXT,
ADD COLUMN     "snmpCredentialId" TEXT;

-- AlterTable
ALTER TABLE "Network" ADD COLUMN     "oidProfileId" TEXT,
ADD COLUMN     "snmpCredentialId" TEXT;

-- CreateTable
CREATE TABLE "SnmpCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "snmpVersion" "SnmpVersion" NOT NULL,
    "securityLevel" "SnmpSecurityLevel",
    "securityName" TEXT,
    "authProtocol" "SnmpAuthProtocol",
    "privProtocol" "SnmpPrivProtocol",
    "communityEnc" TEXT,
    "authKeyEnc" TEXT,
    "privKeyEnc" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnmpCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "includeInterfaceMetrics" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidEntry" (
    "id" TEXT NOT NULL,
    "oidProfileId" TEXT NOT NULL,
    "oid" TEXT NOT NULL,
    "metric" TEXT NOT NULL,

    CONSTRAINT "OidEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SnmpCredential_organizationId_idx" ON "SnmpCredential"("organizationId");

-- CreateIndex
CREATE INDEX "OidProfile_organizationId_idx" ON "OidProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OidEntry_oidProfileId_oid_key" ON "OidEntry"("oidProfileId", "oid");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_snmpCredentialId_fkey" FOREIGN KEY ("snmpCredentialId") REFERENCES "SnmpCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_oidProfileId_fkey" FOREIGN KEY ("oidProfileId") REFERENCES "OidProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Network" ADD CONSTRAINT "Network_snmpCredentialId_fkey" FOREIGN KEY ("snmpCredentialId") REFERENCES "SnmpCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Network" ADD CONSTRAINT "Network_oidProfileId_fkey" FOREIGN KEY ("oidProfileId") REFERENCES "OidProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnmpCredential" ADD CONSTRAINT "SnmpCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OidProfile" ADD CONSTRAINT "OidProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OidEntry" ADD CONSTRAINT "OidEntry_oidProfileId_fkey" FOREIGN KEY ("oidProfileId") REFERENCES "OidProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend the ChangeLog entityType CHECK for the SNMP entities.
ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "changelog_entity_type_check";
ALTER TABLE "ChangeLog" ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device','Circuit','FiberRun','DeviceConnection','Network','Property','NetworkProperty',
                          'Team','TeamMember','TeamProperty','MemberProperty',
                          'BuildingModel','BuildingModelVersion','MonitoringIngestToken',
                          'Agent','AgentEnrollmentCode','SnmpCredential','OidProfile'));
