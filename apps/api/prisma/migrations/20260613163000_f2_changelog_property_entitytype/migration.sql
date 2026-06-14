-- F2 Phase A: Expand the ChangeLog entityType check constraint to include 'Property'.
-- PropertiesService calls AuditService.recordCreate/recordUpdate/recordDelete
-- with entityType = 'Property'. The constraint must be updated to allow it.

ALTER TABLE "ChangeLog"
  DROP CONSTRAINT "changelog_entity_type_check";

ALTER TABLE "ChangeLog"
  ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device', 'Circuit', 'FiberRun', 'DeviceConnection', 'Network', 'Property'));
