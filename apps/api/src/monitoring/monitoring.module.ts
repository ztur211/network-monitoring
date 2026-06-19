import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MonitoringRepository } from './monitoring.repository';
import { IngestService, MONITORING_EMITTER, MonitoringEmitter } from './ingest/ingest.service';

/**
 * Phase A: the storage + ingest seam. MONITORING_EMITTER is a no-op here; Phase B
 * replaces it with an adapter over the realtime gateway's F3-scoped emit (and adds
 * the read controller + Spec 4 wiring). The prober (Phase C) and HTTP ingest +
 * token (Phase D) build on this module.
 */
const noopEmitter: MonitoringEmitter = { emitDeviceStatus: () => undefined };

@Module({
  imports: [PrismaModule],
  providers: [
    MonitoringRepository,
    IngestService,
    { provide: MONITORING_EMITTER, useValue: noopEmitter },
  ],
  exports: [IngestService, MonitoringRepository],
})
export class MonitoringModule {}
