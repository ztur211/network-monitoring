import { describe, it, expect } from 'vitest';
import { reachabilityCollector, pollDevices } from '../poller.js';
import { mapLimit } from '@nodescope/shared';

const devices = [{ id: 'a', name: 'A', ipAddress: '10.0.0.1' }, { id: 'b', name: 'B', ipAddress: '10.0.0.2' }];

describe('poller', () => {
  it('reachabilityCollector emits a check + latency metric', async () => {
    const probe = async (ip: string) => ({ ok: ip === '10.0.0.1', latencyMs: 7 });
    const out = await reachabilityCollector(probe).collect(devices[0]);
    expect(out.checks[0]).toMatchObject({ deviceId: 'a', ok: true, latencyMs: 7 });
    expect(out.metrics[0]).toMatchObject({ deviceId: 'a', metric: 'latency_ms', value: 7 });
  });
  it('pollDevices merges all collectors over all devices', async () => {
    const probe = async (ip: string) => ({ ok: ip === '10.0.0.1', latencyMs: 7 });
    const batch = await pollDevices(devices, [reachabilityCollector(probe)], 2);
    expect(batch.checks.map((c) => c.deviceId).sort()).toEqual(['a', 'b']);
    expect(batch.checks.find((c) => c.deviceId === 'b')!.ok).toBe(false);
  });
  it('mapLimit runs all items', async () => {
    const seen: number[] = [];
    await mapLimit([1, 2, 3], 2, async (n) => { seen.push(n); });
    expect(seen.sort()).toEqual([1, 2, 3]);
  });
  it('mapLimit never exceeds the concurrency cap', async () => {
    let inflight = 0, maxSeen = 0;
    await mapLimit([1, 2, 3, 4, 5], 2, async () => {
      inflight++; maxSeen = Math.max(maxSeen, inflight);
      await new Promise((r) => setTimeout(r, 2));
      inflight--;
    });
    expect(maxSeen).toBeLessThanOrEqual(2);
    expect(maxSeen).toBeGreaterThan(1); // did run in parallel
  });
});
