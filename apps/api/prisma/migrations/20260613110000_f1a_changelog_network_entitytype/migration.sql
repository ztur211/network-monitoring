-- F1a Phase C: Expand the ChangeLog entityType check constraint to include 'Network'.
-- Phase C wires AuditService into all 5 entity services (Device, Network, Circuit,
-- FiberRun, DeviceConnection). The original init constraint only listed 4 types —
-- 'Network' was omitted because the network audit wiring landed in this phase.

ALTER TABLE "ChangeLog"
  DROP CONSTRAINT "changelog_entity_type_check";

ALTER TABLE "ChangeLog"
  ADD CONSTRAINT "changelog_entity_type_check"
  CHECK ("entityType" IN ('Device', 'Circuit', 'FiberRun', 'DeviceConnection', 'Network'));
