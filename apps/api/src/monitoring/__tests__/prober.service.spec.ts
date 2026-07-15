import { runProbeCycle } from '../prober/prober.service';
import { mapLimit } from '@nodescope/shared';

describe('runProbeCycle', () => {
  it('probes every device and reports the result to ingest with source=prober', async () => {
    const calls: { deviceId: string; ok: boolean; source: string }[] = [];
    const ingest = { reportStatusCheck: async (x: any) => void calls.push(x) };
    const probe = async (ip: string) => ({ ok: ip !== '10.0.0.2', latencyMs: 5 });
    await runProbeCycle(
      [
        { id: 'a', organizationId: 'o', ipAddress: '10.0.0.1' },
        { id: 'b', organizationId: 'o', ipAddress: '10.0.0.2' },
      ],
      probe,
      ingest as any,
      2,
    );
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.deviceId === 'b')!.ok).toBe(false);
    expect(calls.every((c) => c.source === 'prober')).toBe(true);
  });

  it('mapLimit runs every item under a concurrency cap and never exceeds it', async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(n);
      inFlight--;
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
