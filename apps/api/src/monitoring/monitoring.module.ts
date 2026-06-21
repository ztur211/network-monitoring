import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DevicesModule } from '../devices/devices.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ConflictResolutionModule } from '../conflict/conflict.module';
import { AgentModule } from '../agents/agents.module';
import { MonitoringRepository } from './monitoring.repository';
import { IngestService, MONITORING_EMITTER } from './ingest/ingest.service';
import { MonitoringGatewayEmitter } from './ingest/monitoring-gateway.emitter';
import { MonitoringService } from './status/monitoring.service';
import { MonitoringController } from './status/monitoring.controller';
import { ProberService } from './prober/prober.service';
import { IngestTokenService } from './ingest/ingest-token.service';
import { IngestTokenGuard } from './ingest/ingest-token.guard';
import { IngestController } from './ingest/ingest.controller';
import { MonitoringCaggService } from './monitoring-cagg.service';

/**
 * Monitoring pipeline. Phase A: storage + ingest seam. Phase B (this): the
 * v1:device:status emit bound to the F3-scoped realtime gateway + the scoped
 * device-status/metrics read APIs. Phase C adds the embedded prober; Phase D the
 * HTTP ingest endpoint + per-org token.
 */
@Module({
  imports: [PrismaModule, DevicesModule, PermissionsModule, ConflictResolutionModule, AgentModule],
  controllers: [MonitoringController, IngestController],
  providers: [
    MonitoringRepository,
    MonitoringCaggService,
    IngestService,
    MonitoringService,
    MonitoringGatewayEmitter,
    { provide: MONITORING_EMITTER, useExisting: MonitoringGatewayEmitter },
    ProberService,
    IngestTokenService,
    IngestTokenGuard,
  ],
  exports: [IngestService, MonitoringRepository],
})
export class MonitoringModule {}
