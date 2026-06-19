import { Injectable } from '@nestjs/common';
import { WS_EVENTS } from '@nodescope/shared';
import { ConflictResolutionService } from '../../conflict/conflict.service';
import { DeviceStatusEmit, MonitoringEmitter } from './ingest.service';

/**
 * Adapts Phase A's MONITORING_EMITTER port to the realtime gateway's F3-scoped
 * device-event fan-out (ConflictResolutionService.emitScoped): the v1:device:status
 * event reaches org:{org} sockets filtered to the device's governingSiteId scope (F3 §8),
 * exactly like device CRUD events.
 */
@Injectable()
export class MonitoringGatewayEmitter implements MonitoringEmitter {
  constructor(private readonly conflict: ConflictResolutionService) {}

  emitDeviceStatus(p: DeviceStatusEmit): void {
    // Fire-and-forget: status realtime is best-effort and must not block the ingest path.
    Promise.resolve(
      this.conflict.emitScoped(p.organizationId, p.governingSiteId, WS_EVENTS.DEVICE_STATUS, {
        deviceId: p.deviceId,
        state: p.state,
        latencyMs: p.latencyMs,
        at: p.at,
      }),
    ).catch(() => undefined);
  }
}
