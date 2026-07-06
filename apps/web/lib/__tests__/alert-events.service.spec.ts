/**
 * Unit test for the pure `AlertRealtimePayload → AlertEventDto` mapper in
 * alert-events.service.ts. The socket subscription wiring itself
 * (subscribeToAlertEvents) isn't covered here — it's a thin pass-through to
 * websocketService.subscribe, already exercised indirectly by
 * websocket.service.spec.ts's routing tests. This file just locks down the
 * mapping: FIRING/RESOLVED kind, id/ruleId/deviceId/severity/detail passed
 * through, `at` → `createdAt`, and the DB-only fields (organizationId,
 * dedupKey) the realtime payload doesn't carry defaulting to ''.
 */
import { toFeedItem } from '../alert-events.service';
import type { AlertRealtimePayload } from '@nodescope/shared';

const payload: AlertRealtimePayload = {
  id: 'evt-1',
  ruleId: 'rule-1',
  deviceId: 'device-1',
  severity: 'CRITICAL',
  detail: { latencyMs: 900 },
  at: '2026-07-01T12:00:00Z',
};

describe('alert-events.service — toFeedItem', () => {
  it('maps a FIRING realtime payload into a feed item', () => {
    const item = toFeedItem(payload, 'FIRING');
    expect(item).toEqual({
      id: 'evt-1',
      organizationId: '',
      ruleId: 'rule-1',
      deviceId: 'device-1',
      kind: 'FIRING',
      severity: 'CRITICAL',
      detail: { latencyMs: 900 },
      dedupKey: '',
      createdAt: '2026-07-01T12:00:00Z',
    });
  });

  it('maps a RESOLVED realtime payload into a feed item', () => {
    const item = toFeedItem(payload, 'RESOLVED');
    expect(item.kind).toBe('RESOLVED');
    expect(item.id).toBe(payload.id);
    expect(item.ruleId).toBe(payload.ruleId);
    expect(item.deviceId).toBe(payload.deviceId);
    expect(item.severity).toBe(payload.severity);
    expect(item.detail).toBe(payload.detail);
    expect(item.createdAt).toBe(payload.at);
    expect(item.organizationId).toBe('');
    expect(item.dedupKey).toBe('');
  });
});
