import { describe, it, expect, vi } from 'vitest';
import {
  snmpCollector,
  SYS_UPTIME,
  IF_HC_IN_OCTETS,
  IF_HC_OUT_OCTETS,
  IF_OPER_STATUS,
  type SnmpSession,
  type SnmpSessionFactory,
} from '../collectors/snmp-collector.js';
import type { AgentDeviceDto } from '@nodescope/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SnmpSession> = {}): SnmpSession {
  return {
    get: vi.fn().mockResolvedValue({}),
    walkColumn: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
    ...overrides,
  };
}

function makeFactory(session: SnmpSession): SnmpSessionFactory {
  return (_target, _host) => session;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('snmpCollector', () => {
  it('returns empty result for device with no .snmp property', async () => {
    const device: AgentDeviceDto = { id: 'dev1', name: 'Router1', ipAddress: '10.0.0.1' };
    // No factory calls should happen since snmp is absent
    const factory = vi.fn() as unknown as SnmpSessionFactory;
    const collector = snmpCollector(factory);

    const result = await collector.collect(device);

    expect(result).toEqual({ checks: [], metrics: [] });
    expect(factory).not.toHaveBeenCalled();
  });

  it('emits sys_uptime, custom oid metrics, and per-interface metrics', async () => {
    const device: AgentDeviceDto = {
      id: 'dev2',
      name: 'Switch1',
      ipAddress: '10.0.0.2',
      snmp: {
        version: 'V2C',
        community: 'public',
        oids: [{ oid: '1.3.6.1.2.1.1.1.0', metric: 'sys_descr' }],
        interfaceMetrics: true,
      },
    };

    // sysUpTime = 36000 hundredths → 360 seconds
    // custom oid = 42
    const getResult: Record<string, unknown> = {
      [SYS_UPTIME]: 36000,
      '1.3.6.1.2.1.1.1.0': 42,
    };

    // walkColumn results: ifIndex "1" and "2"
    const inOctetsResult: Record<string, unknown> = { '1': 1000000, '2': 2000000 };
    const outOctetsResult: Record<string, unknown> = { '1': 500000, '2': 750000 };
    const operStatusResult: Record<string, unknown> = { '1': 1, '2': 2 };

    const session = makeSession({
      get: vi.fn().mockResolvedValue(getResult),
      walkColumn: vi.fn()
        .mockImplementationOnce(() => Promise.resolve(inOctetsResult))
        .mockImplementationOnce(() => Promise.resolve(outOctetsResult))
        .mockImplementationOnce(() => Promise.resolve(operStatusResult)),
    });

    const collector = snmpCollector(makeFactory(session));
    const result = await collector.collect(device);

    // --- session interactions ---
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(session.get).toHaveBeenCalledWith([SYS_UPTIME, '1.3.6.1.2.1.1.1.0']);
    expect(session.walkColumn).toHaveBeenCalledTimes(3);
    expect(session.walkColumn).toHaveBeenNthCalledWith(1, IF_HC_IN_OCTETS);
    expect(session.walkColumn).toHaveBeenNthCalledWith(2, IF_HC_OUT_OCTETS);
    expect(session.walkColumn).toHaveBeenNthCalledWith(3, IF_OPER_STATUS);

    // --- emitted metrics ---
    const metricNames = result.metrics.map((m) => m.metric);

    // sys_uptime
    expect(metricNames).toContain('sys_uptime');
    const sysUptimeMetric = result.metrics.find((m) => m.metric === 'sys_uptime');
    expect(sysUptimeMetric?.value).toBe(360); // 36000 / 100

    // custom OID metric
    expect(metricNames).toContain('sys_descr');
    const sysDescrMetric = result.metrics.find((m) => m.metric === 'sys_descr');
    expect(sysDescrMetric?.value).toBe(42);

    // interface metrics — ifIndex 1
    expect(metricNames).toContain('if_hc_in_octets.1');
    expect(result.metrics.find((m) => m.metric === 'if_hc_in_octets.1')?.value).toBe(1000000);
    expect(metricNames).toContain('if_hc_out_octets.1');
    expect(result.metrics.find((m) => m.metric === 'if_hc_out_octets.1')?.value).toBe(500000);
    expect(metricNames).toContain('if_oper_status.1');
    expect(result.metrics.find((m) => m.metric === 'if_oper_status.1')?.value).toBe(1);

    // interface metrics — ifIndex 2
    expect(metricNames).toContain('if_hc_in_octets.2');
    expect(metricNames).toContain('if_hc_out_octets.2');
    expect(metricNames).toContain('if_oper_status.2');

    expect(result.checks).toHaveLength(0);

    // 1 sys_uptime + 1 custom + 3 * 2 interfaces = 8 total
    expect(result.metrics).toHaveLength(8);
  });

  it('returns empty result and does not throw when session throws', async () => {
    const device: AgentDeviceDto = {
      id: 'dev3',
      name: 'BrokenDevice',
      ipAddress: '10.0.0.3',
      snmp: {
        version: 'V2C',
        community: 'public',
        oids: [],
        interfaceMetrics: false,
      },
    };

    const session = makeSession({
      get: vi.fn().mockRejectedValue(new Error('SNMP timeout')),
    });

    const collector = snmpCollector(makeFactory(session));

    // Must not throw
    const result = await collector.collect(device);

    expect(result).toEqual({ checks: [], metrics: [] });
    // close() must still be called even after an error (finally block)
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
