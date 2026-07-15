import { IngestService } from '../ingest.service';
import { INGEST_MAX_CHECKS_PER_BATCH } from '../ingest.dto';

/**
 * ingestBatch fans out one deviceStatus.upsert per check. That fan-out used to be an unbounded
 * `Promise.all`, so a batch at the endpoint's cap fired 1000 concurrent queries at a Prisma pool
 * whose default size is num_cpus*2+1 - draining the pool that every OTHER request and background
 * job shares. This pins the bound.
 */
describe('IngestService.ingestBatch fan-out', () => {
  it('never runs more than a bounded number of status upserts at once', async () => {
    const checks = Array.from({ length: INGEST_MAX_CHECKS_PER_BATCH }, (_, i) => ({ deviceId: `d${i}`, ok: true, latencyMs: 1 }));

    let inFlight = 0;
    let peak = 0;
    const repo = {
      listStatus: jest.fn().mockResolvedValue([]),
      upsertStatus: jest.fn().mockImplementation(async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setImmediate(r)); // force real interleaving
        inFlight--;
      }),
      insertMetrics: jest.fn().mockResolvedValue(0),
      insertStatusEvents: jest.fn().mockResolvedValue(0),
    };
    const prisma = {
      device: { findMany: jest.fn().mockResolvedValue(checks.map((c) => ({ id: c.deviceId, propertyId: 'p1' }))) },
    };
    const emitter = { emitDeviceStatus: jest.fn() };

    const svc = new IngestService(prisma as never, repo as never, emitter);
    await svc.ingestBatch('org-1', checks, [], 'agent:1');

    expect(repo.upsertStatus).toHaveBeenCalledTimes(INGEST_MAX_CHECKS_PER_BATCH); // every check still written
    expect(peak).toBeLessThanOrEqual(16); // bounded: not one query per check
    expect(peak).toBeGreaterThan(1); // …but still pipelined, not serial
    expect(repo.insertMetrics).toHaveBeenCalledTimes(1); // metrics still one multi-row INSERT
  });
});
