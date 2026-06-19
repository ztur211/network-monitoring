import { WS_EVENTS } from '@nodescope/shared';
import { MonitoringGatewayEmitter } from '../ingest/monitoring-gateway.emitter';

describe('MonitoringGatewayEmitter', () => {
  it('forwards a scoped device-status event to the gateway', () => {
    const conflict = { emitScoped: jest.fn().mockResolvedValue(undefined) } as any;
    new MonitoringGatewayEmitter(conflict).emitDeviceStatus({
      organizationId: 'o',
      deviceId: 'd',
      governingSiteId: 'p',
      state: 'DOWN',
      latencyMs: null,
      at: 't',
    });
    expect(conflict.emitScoped).toHaveBeenCalledWith('o', 'p', WS_EVENTS.DEVICE_STATUS, {
      deviceId: 'd',
      state: 'DOWN',
      latencyMs: null,
      at: 't',
    });
  });

  it('does not throw if the scoped emit rejects (best-effort)', () => {
    const conflict = { emitScoped: jest.fn().mockRejectedValue(new Error('socket down')) } as any;
    expect(() =>
      new MonitoringGatewayEmitter(conflict).emitDeviceStatus({
        organizationId: 'o',
        deviceId: 'd',
        governingSiteId: 'p',
        state: 'UP',
        latencyMs: 5,
        at: 't',
      }),
    ).not.toThrow();
  });
});
