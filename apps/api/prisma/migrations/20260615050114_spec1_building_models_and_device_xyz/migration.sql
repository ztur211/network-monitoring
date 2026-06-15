-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "x" DOUBLE PRECISION,
ADD COLUMN     "y" DOUBLE PRECISION,
ADD COLUMN     "z" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "BuildingModel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildingModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingModelVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buildingModelId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "units" TEXT,
    "uploadedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildingModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuildingModel_propertyId_key" ON "BuildingModel"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildingModel_activeVersionId_key" ON "BuildingModel"("activeVersionId");

-- CreateIndex
CREATE INDEX "BuildingModel_organizationId_idx" ON "BuildingModel"("organizationId");

-- CreateIndex
CREATE INDEX "BuildingModelVersion_organizationId_idx" ON "BuildingModelVersion"("organizationId");

-- CreateIndex
CREATE INDEX "BuildingModelVersion_buildingModelId_idx" ON "BuildingModelVersion"("buildingModelId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildingModelVersion_buildingModelId_versionNumber_key" ON "BuildingModelVersion"("buildingModelId", "versionNumber");

-- AddForeignKey
ALTER TABLE "BuildingModel" ADD CONSTRAINT "BuildingModel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingModel" ADD CONSTRAINT "BuildingModel_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingModel" ADD CONSTRAINT "BuildingModel_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "BuildingModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingModelVersion" ADD CONSTRAINT "BuildingModelVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingModelVersion" ADD CONSTRAINT "BuildingModelVersion_buildingModelId_fkey" FOREIGN KEY ("buildingModelId") REFERENCES "BuildingModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend the ChangeLog entityType CHECK to cover the new spatial entities (raw SQL —
-- Prisma can't model CHECK constraints). Superset of the current F3 list; do NOT drop
-- any existing type or audit writes for it will start violating the constraint.
ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "changelog_entity_type_check";
ALTER TABLE "ChangeLog" ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device','Circuit','FiberRun','DeviceConnection','Network','Property','NetworkProperty',
                          'Team','TeamMember','TeamProperty','MemberProperty',
                          'BuildingModel','BuildingModelVersion'));
