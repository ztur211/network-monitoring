-- F2 Phase B: Expand the ChangeLog entityType check constraint to include 'NetworkProperty'.
-- NetworkPropertyService calls AuditService.recordCreate/recordDelete
-- with entityType = 'NetworkProperty'. The constraint must be updated to allow it.

ALTER TABLE "ChangeLog"
  DROP CONSTRAINT "changelog_entity_type_check";

ALTER TABLE "ChangeLog"
  ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device', 'Circuit', 'FiberRun', 'DeviceConnection', 'Network', 'Property', 'NetworkProperty'));
