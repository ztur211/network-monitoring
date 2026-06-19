-- NOTE: Prisma emits `DROP INDEX "device_location_idx"` because it does not model
-- the PostGIS GIST index on Device.location (an Unsupported() column). That index
-- is managed by raw SQL and must be preserved, so the spurious drop is intentionally
-- removed (same convention as spec7/spec8/spec9 migrations).
-- NOTE: Prisma also emits `DROP TABLE "DeviceStatusEvent"` and
-- `DROP TABLE "MonitoringMetric"` because those are raw-SQL TimescaleDB hypertables
-- not modelled in Prisma. They must be preserved — spurious drops removed.

-- CreateTable
CREATE TABLE "BcfTopic" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topicType" TEXT,
    "topicStatus" TEXT,
    "priority" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creationAuthor" TEXT NOT NULL,
    "creationDate" TIMESTAMP(3) NOT NULL,
    "modifiedAuthor" TEXT,
    "modifiedDate" TIMESTAMP(3),
    "assignedTo" TEXT,
    "dueDate" TIMESTAMP(3),
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BcfTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BcfComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "viewpointGuid" TEXT,

    CONSTRAINT "BcfComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BcfViewpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "camera" JSONB NOT NULL,
    "components" JSONB NOT NULL,
    "clippingPlanes" JSONB NOT NULL,
    "snapshotKey" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BcfViewpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BcfTopicDevice" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "BcfTopicDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BcfTopic_organizationId_propertyId_idx" ON "BcfTopic"("organizationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "BcfTopic_organizationId_guid_key" ON "BcfTopic"("organizationId", "guid");

-- CreateIndex
CREATE INDEX "BcfComment_topicId_idx" ON "BcfComment"("topicId");

-- CreateIndex
CREATE INDEX "BcfViewpoint_topicId_idx" ON "BcfViewpoint"("topicId");

-- CreateIndex
CREATE INDEX "BcfTopicDevice_deviceId_idx" ON "BcfTopicDevice"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "BcfTopicDevice_topicId_deviceId_key" ON "BcfTopicDevice"("topicId", "deviceId");

-- AddForeignKey
ALTER TABLE "BcfTopic" ADD CONSTRAINT "BcfTopic_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BcfComment" ADD CONSTRAINT "BcfComment_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "BcfTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BcfViewpoint" ADD CONSTRAINT "BcfViewpoint_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "BcfTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BcfTopicDevice" ADD CONSTRAINT "BcfTopicDevice_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "BcfTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend the ChangeLog entityType CHECK for the BCF entities.
ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "changelog_entity_type_check";
ALTER TABLE "ChangeLog" ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device','Circuit','FiberRun','DeviceConnection','Network','Property','NetworkProperty',
                          'Team','TeamMember','TeamProperty','MemberProperty',
                          'BuildingModel','BuildingModelVersion','MonitoringIngestToken',
                          'Agent','AgentEnrollmentCode','SnmpCredential','OidProfile',
                          'BcfTopic','BcfComment'));
