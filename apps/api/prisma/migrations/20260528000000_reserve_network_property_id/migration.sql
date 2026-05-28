-- Reserves Network.propertyId for the post-MVP Multi-Property tier (Priority 2).
-- The future Property model will sit between User and Network:
--   User → Property (1:many) → Network (1:many) → Device (1:many)
-- Adding the FK column + index now means rolling out MULTI_PROPERTY won't touch
-- existing Network rows; the migration is purely additive (nullable, no default
-- needed). Null in MVP — services do not read or write this column.
--
-- Device.propertyId and DeviceMetric.propertyId are NOT reserved on purpose —
-- devices reach their Property via Device → Network → Property. If a query
-- workload later proves the join too expensive, denormalize then with a
-- measurement to justify the cost.

ALTER TABLE "Network" ADD COLUMN "propertyId" TEXT;
CREATE INDEX "Network_userId_propertyId_idx" ON "Network"("userId", "propertyId");
