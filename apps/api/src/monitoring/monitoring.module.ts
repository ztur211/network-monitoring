import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DevicesModule } from '../devices/devices.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { MonitoringRepository } from './monitoring.repository';
import { IngestService, MONITORING_EMITTER } from './ingest/ingest.service';
import { MonitoringGatewayEmitter } from './ingest/monitoring-gateway.emitter';
import { MonitoringService } from './status/monitoring.service';
import { MonitoringController } from './status/monitoring.controller';

/**
 * Monitoring pipeline. Phase A: storage + ingest seam. Phase B (this): the
 * v1:device:status emit bound to the F3-scoped realtime gateway + the scoped
 * device-status/metrics read APIs. Phase C adds the embedded prober; Phase D the
 * HTTP ingest endpoint + per-org token.
 */
@Module({
  imports: [PrismaModule, DevicesModule, PermissionsModule, ConflictResolutionModule],
  controllers: [MonitoringController],
  providers: [
    MonitoringRepository,
    IngestService,
    MonitoringService,
    MonitoringGatewayEmitter,
    { provide: MONITORING_EMITTER, useExisting: MonitoringGatewayEmitter },
  ],
  exports: [IngestService, MonitoringRepository],
})
export class MonitoringModule {}
