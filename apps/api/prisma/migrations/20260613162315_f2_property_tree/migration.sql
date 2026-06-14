-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('SITE', 'BUILDING', 'FLOOR', 'AREA');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "PropertyType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_organizationId_idx" ON "Property"("organizationId");

-- CreateIndex
CREATE INDEX "Property_organizationId_parentId_idx" ON "Property"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "Property_organizationId_type_idx" ON "Property"("organizationId", "type");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (case-insensitive sibling-name uniqueness — functional indexes not managed by Prisma)
CREATE UNIQUE INDEX "property_parent_name_lower_uniq"
  ON "Property" ("organizationId", "parentId", lower("name")) WHERE "parentId" IS NOT NULL;
CREATE UNIQUE INDEX "property_root_name_lower_uniq"
  ON "Property" ("organizationId", lower("name")) WHERE "parentId" IS NULL;
