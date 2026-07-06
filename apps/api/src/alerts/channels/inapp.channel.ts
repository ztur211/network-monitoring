import { Injectable } from '@nestjs/common';
import { AlertChannel, AlertEvent } from '@prisma/client';
import { WS_EVENTS } from '@nodescope/shared';
import { ConflictResolutionService } from '../../conflict/conflict.service';

@Injectable()
export class InAppChannel {
  constructor(private readonly conflict: ConflictResolutionService) {}

  async send(_channel: AlertChannel, event: AlertEvent): Promise<void> {
    const wsEvent = event.kind === 'FIRING' ? WS_EVENTS.ALERT_FIRED : WS_EVENTS.ALERT_RESOLVED;
    this.conflict.emitEntityEvent(wsEvent, {
      id: event.id, ruleId: event.ruleId, deviceId: event.deviceId, severity: event.severity, detail: event.detail, at: event.createdAt,
    }, event.organizationId);
  }
}
