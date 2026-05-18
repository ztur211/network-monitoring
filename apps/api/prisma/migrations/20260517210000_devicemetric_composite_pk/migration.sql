-- Convert DeviceMetric.PRIMARY KEY from (id) to (id, time).
--
-- TimescaleDB requires the partitioning column (here: `time`) to be a member
-- of every unique constraint on a hypertable. The init migration created a
-- single-column PK on (id), which made `SELECT create_hypertable(...)` fail
-- with: "cannot create a unique index without the column 'time'".
-- TimescaleService.initializeHypertable() runs that SQL at boot and called
-- process.exit(1) on failure, leaving the API silently dead.
--
-- This is additive on top of the init migration: no DeviceMetric rows exist
-- in any environment that has reached this migration (the hypertable was
-- never successfully created, so the table is empty).

ALTER TABLE "DeviceMetric" DROP CONSTRAINT "DeviceMetric_pkey";
ALTER TABLE "DeviceMetric" ADD CONSTRAINT "DeviceMetric_pkey" PRIMARY KEY ("id", "time");
