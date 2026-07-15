import { describe, it, expect, vi } from 'vitest';
import { runCycle } from '../runtime.js';
import { INGEST_MAX_ITEMS_PER_BATCH } from '../buffer.js';
import type { IngestBatchDto } from '@nodescope/shared';
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

  it('still heartbeats when drain throws (liveness decoupled from ingest delivery)', async () => {
    const client = {
      syncDevices: vi.fn().mockResolvedValue([{ id: 'a', name: 'A', ipAddress: '10.0.0.1' }]),
      ingest: vi.fn().mockResolvedValue(undefined),
      heartbeat: vi.fn().mockResolvedValue(undefined),
    };
    const buf = {
      enqueue: vi.fn(),
      drain: vi.fn().mockRejectedValue(Object.assign(new Error('ingest 503'), { status: 503 })),
      size: () => 0,
    };
    const probe = async () => ({ ok: true, latencyMs: 3 });

    // The drain error still propagates (the cycle is not silently "successful")…
    await expect(
      runCycle({ client: client as any, buffer: buf as any, probe, concurrency: 4, snmpFactory: fakeSnmpFactory }),
    ).rejects.toThrow('ingest 503');
    // …but the heartbeat went out regardless, so the backend won't mark a healthy agent offline.
    expect(client.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('chunks a large fleet into server-sized batches instead of one oversized request', async () => {
    // 1200 devices: one batch per cycle used to mean one request with 1200 checks, which blew past
    // the API's body limit - and the agent then threw the 413'd batch away.
    const devices = Array.from({ length: 1200 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, ipAddress: `10.0.${(i / 256) | 0}.${i % 256}` }));
    const client = {
      syncDevices: vi.fn().mockResolvedValue(devices),
      ingest: vi.fn().mockResolvedValue(undefined),
      heartbeat: vi.fn().mockResolvedValue(undefined),
    };
    const enqueued: IngestBatchDto[] = [];
    const buf = { enqueue: vi.fn((b: IngestBatchDto) => { enqueued.push(b); }), drain: vi.fn().mockResolvedValue(undefined), size: () => 0 };
    const probe = async () => ({ ok: true, latencyMs: 3 });

    await runCycle({ client: client as any, buffer: buf as any, probe, concurrency: 8, snmpFactory: fakeSnmpFactory });

    expect(enqueued).toHaveLength(3); // ceil(1200 / 500)
    for (const b of enqueued) {
      expect(b.checks!.length).toBeLessThanOrEqual(INGEST_MAX_ITEMS_PER_BATCH);
      expect(b.metrics!.length).toBeLessThanOrEqual(INGEST_MAX_ITEMS_PER_BATCH);
    }
    // Every device is still accounted for - chunking must not lose any.
    expect(new Set(enqueued.flatMap((b) => b.checks!.map((c) => c.deviceId))).size).toBe(1200);
  });
});
