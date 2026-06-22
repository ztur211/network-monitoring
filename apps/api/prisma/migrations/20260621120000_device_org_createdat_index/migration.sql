-- Composite index for the device-list query (WHERE "organizationId" ORDER BY "createdAt" DESC):
-- lets Postgres satisfy both the equality filter and the sort from a single index, avoiding the
-- in-memory sort that the existing "organizationId"-only index forced.
CREATE INDEX "Device_organizationId_createdAt_idx" ON "Device"("organizationId", "createdAt");
