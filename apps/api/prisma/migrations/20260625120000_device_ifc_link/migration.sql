-- Device <-> IFC element GUID link (the only join key between network data and the BIM model).
-- A device may be linked to the native IFC GlobalId of the BIM element that represents it, so that
-- clicking the BIM object in the 3D viewer resolves to the device's live network info. The IFC
-- export carries the element's native GlobalId but no network data, keeping the two data sets
-- isolated. Nullable + independent of x/y/z placement.
ALTER TABLE "Device" ADD COLUMN "ifcGlobalId" TEXT;

-- Reverse lookup: clicked element GlobalId -> linked device, scoped to the org.
CREATE INDEX "Device_organizationId_ifcGlobalId_idx" ON "Device"("organizationId", "ifcGlobalId");
