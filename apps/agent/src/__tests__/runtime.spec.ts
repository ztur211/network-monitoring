import { describe, it, expect, vi } from 'vitest';
import { runCycle } from '../runtime.js';
import type { SnmpSessionFactory } from '../collectors/snmp-collector.js';

// Fake SNMP factory: session does nothing (test devices have no .snmp, so
// snmpCollector never calls the factory, but the type must satisfy the interface).
const fakeSnmpFactory: SnmpSessionFactory = () => ({
  get: () => Promise.resolve({}),
  walkColumn: () => Promise.resolve({}),
  close: () => { /* no-op */ },
});

describe('runCycle', () => {
  it('syncs → polls → enqueues → drains → heartbeats', async () => {
    const client = {
      syncDevices: vi.fn().mockResolvedValue([{ id: 'a', name: 'A', ipAddress: '10.0.0.1' }]),
      ingest: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn().mockResolvedValue(undefined),
    };
    const buf = { enqueue: vi.fn(), drain: vi.fn().mockImplementation(async (f: any) => f({ checks: [], metrics: [] })), size: () => 0 };
    const probe = async () => ({ ok: true, latencyMs: 3 });
    await runCycle({ client: client as any, buffer: buf as any, probe, concurrency: 4, snmpFactory: fakeSnmpFactory });
    expect(client.syncDevices).toHaveBeenCalled();
    expect(buf.enqueue).toHaveBeenCalledTimes(1);
    expect(buf.drain).toHaveBeenCalledWith(client.ingest);
    expect(client.heartbeat).toHaveBeenCalled();
  });
});
