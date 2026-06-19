-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('PENDING', 'APPROVED', 'REVOKED');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "version" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'APPROVED',
    "lastSeenAt" TIMESTAMP(3),
    "tokenHash" TEXT NOT NULL,
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEnrollmentCode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByMemberId" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEnrollmentCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_tokenHash_key" ON "Agent"("tokenHash");

-- CreateIndex
CREATE INDEX "Agent_organizationId_idx" ON "Agent"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEnrollmentCode_codeHash_key" ON "AgentEnrollmentCode"("codeHash");

-- CreateIndex
CREATE INDEX "AgentEnrollmentCode_organizationId_idx" ON "AgentEnrollmentCode"("organizationId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEnrollmentCode" ADD CONSTRAINT "AgentEnrollmentCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend the ChangeLog entityType CHECK to allow agent-registry audit rows.
ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "changelog_entity_type_check";
ALTER TABLE "ChangeLog" ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device','Circuit','FiberRun','DeviceConnection','Network','Property','NetworkProperty',
                          'Team','TeamMember','TeamProperty','MemberProperty',
                          'BuildingModel','BuildingModelVersion','MonitoringIngestToken',
                          'Agent','AgentEnrollmentCode'));
