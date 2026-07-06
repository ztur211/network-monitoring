// Alert-status event subscriptions. Two pushes from the gateway feed the
// alerts store:
//
//   v1:alert:fired — emitted when an alert rule transitions into a firing
//     state (InAppChannel.send). Prepended to the feed as a FIRING item.
//
//   v1:alert:resolved — emitted when a previously-firing alert clears.
//     Prepended to the feed as a RESOLVED item.
//
// The realtime payload (AlertRealtimePayload) is narrower than the persisted
// AlertEventDto — it has no organizationId/dedupKey (those are DB-only
// bookkeeping, irrelevant to a live feed item) — so those are filled with ''
// when mapping into the feed's AlertEventDto shape.
import { WS_EVENTS } from '@nodescope/shared';
import type { AlertRealtimePayload, AlertEventDto, AlertEventKind } from '@nodescope/shared';
import { websocketService } from './websocket.service';
import { useAlertsStore } from '../store/alerts.store';

function toFeedItem(payload: AlertRealtimePayload, kind: AlertEventKind): AlertEventDto {
  return {
    id: payload.id,
    organizationId: '',
    ruleId: payload.ruleId,
    deviceId: payload.deviceId,
    kind,
    severity: payload.severity,
    detail: payload.detail,
    dedupKey: '',
    createdAt: payload.at,
  };
}

export function subscribeToAlertEvents(): () => void {
  const offFired = websocketService.subscribe<AlertRealtimePayload>(WS_EVENTS.ALERT_FIRED, (data) => {
    useAlertsStore.getState().prepend(toFeedItem(data, 'FIRING'));
  });
  const offResolved = websocketService.subscribe<AlertRealtimePayload>(
    WS_EVENTS.ALERT_RESOLVED,
    (data) => {
      useAlertsStore.getState().prepend(toFeedItem(data, 'RESOLVED'));
    },
  );
  return () => {
    offFired();
    offResolved();
  };
}
