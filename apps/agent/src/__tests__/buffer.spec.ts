import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IngestBatchDto } from '@nodescope/shared';
import { createBuffer, chunkBatch, splitBatch, INGEST_MAX_ITEMS_PER_BATCH } from '../buffer.js';

const path = () => join(mkdtempSync(join(tmpdir(), 'buf-')), 'queue.jsonl');

const http = (status: number) => Object.assign(new Error(String(status)), { status });
const checks = (n: number, o = 0) => Array.from({ length: n }, (_, i) => ({ deviceId: `d${i + o}`, ok: true }));
const metrics = (n: number, o = 0) => Array.from({ length: n }, (_, i) => ({ deviceId: `d${i + o}`, metric: 'latency_ms', value: 1 }));
const items = (b: IngestBatchDto) => (b.checks?.length ?? 0) + (b.metrics?.length ?? 0);

describe('buffer', () => {
  it('persists, drains on success, keeps on failure', async () => {
    const p = path();
    const buf = createBuffer({ path: p, maxItems: 10 });
    buf.enqueue({ checks: [{ deviceId: 'a', ok: true }], metrics: [] });
    expect(buf.size()).toBe(1);
    await buf.drain(async () => { throw new Error('offline'); }).catch(() => {});
    expect(buf.size()).toBe(1);                              // kept
    expect(createBuffer({ path: p, maxItems: 10 }).size()).toBe(1); // persisted across restart
    const flush = vi.fn().mockResolvedValue(undefined);
    await buf.drain(flush);
    expect(flush).toHaveBeenCalledTimes(1); expect(buf.size()).toBe(0);
  });
  it('drops oldest beyond the cap and keeps newest', async () => {
    const buf = createBuffer({ path: path(), maxItems: 2 });
    buf.enqueue({ checks: [{ deviceId: '1', ok: true }], metrics: [] });
    buf.enqueue({ checks: [{ deviceId: '2', ok: true }], metrics: [] });
    buf.enqueue({ checks: [{ deviceId: '3', ok: true }], metrics: [] });
    expect(buf.size()).toBe(2);
    const drained: string[] = [];
    await buf.drain(async (b) => { drained.push(b.checks![0].deviceId); });
    expect(drained).toEqual(['2', '3']); // oldest ('1') was evicted
  });
  it('drops a batch on a permanent 4xx error and continues to later batches', async () => {
    const buf = createBuffer({ path: path(), maxItems: 10 });
    buf.enqueue({ checks: [{ deviceId: 'bad', ok: false }], metrics: [] });
    buf.enqueue({ checks: [{ deviceId: 'good', ok: true }], metrics: [] });
    expect(buf.size()).toBe(2);
    const drained: string[] = [];
    let call = 0;
    await buf.drain(async (b) => {
      call++;
      if (call === 1) { const e = new Error('404'); (e as unknown as { status: number }).status = 404; throw e; }
      drained.push(b.checks![0].deviceId);
    });
    expect(buf.size()).toBe(0);          // both processed (bad dropped, good flushed)
    expect(drained).toEqual(['good']);
  });
  it('keeps the head batch on a transient error (network/5xx/429) and stops draining', async () => {
    const buf = createBuffer({ path: path(), maxItems: 10 });
    buf.enqueue({ checks: [{ deviceId: 'first', ok: true }], metrics: [] });
    buf.enqueue({ checks: [{ deviceId: 'second', ok: true }], metrics: [] });
    await buf.drain(async () => { const e = new Error('503'); (e as unknown as { status: number }).status = 503; throw e; }).catch(() => {});
    expect(buf.size()).toBe(2); // head kept, drain stopped
  });

  // --- 413: too big is NOT permanent. This is the data-loss bug. ---------------------------------

  it('splits and retries on 413 instead of dropping - every item still reaches the server', async () => {
    const buf = createBuffer({ path: path(), maxItems: 10 });
    buf.enqueue({ checks: checks(8), metrics: metrics(8) });

    // A server that refuses anything over 4 items, exactly as the API's per-batch cap does.
    const delivered: string[] = [];
    await buf.drain(async (b) => {
      if (items(b) > 4) throw http(413);
      for (const c of b.checks ?? []) delivered.push(`c:${c.deviceId}`);
      for (const m of b.metrics ?? []) delivered.push(`m:${m.deviceId}`);
    });

    expect(buf.size()).toBe(0);
    expect(delivered).toHaveLength(16); // NOTHING was dropped
    expect(new Set(delivered).size).toBe(16); // and nothing was duplicated
  });

  it('drops only the unsplittable single item on a 413 (never wedges the queue forever)', async () => {
    const buf = createBuffer({ path: path(), maxItems: 10 });
    buf.enqueue({ checks: [{ deviceId: 'poison', ok: true }], metrics: [] });
    buf.enqueue({ checks: [{ deviceId: 'good', ok: true }], metrics: [] });

    const delivered: string[] = [];
    let call = 0;
    await buf.drain(async (b) => {
      if (++call === 1) throw http(413); // even a single item is refused
      delivered.push(b.checks![0].deviceId);
    });

    expect(buf.size()).toBe(0);
    expect(delivered).toEqual(['good']); // the queue drained rather than retrying forever
  });

  it('survives a server whose cap is far below the agent chunk size (drift between the two)', async () => {
    const buf = createBuffer({ path: path(), maxItems: 10 });
    buf.enqueue({ checks: checks(50), metrics: [] });

    let requests = 0;
    const delivered = new Set<string>();
    await buf.drain(async (b) => {
      requests++;
      if (items(b) > 1) throw http(413); // pathological: server accepts one item at a time
      delivered.add(b.checks![0].deviceId);
    });

    expect(delivered.size).toBe(50); // degrades into MORE REQUESTS, never into lost data
    expect(requests).toBeGreaterThan(50);
  });
});

describe('chunkBatch', () => {
  it('never emits a chunk over the cap, and preserves every item exactly once', () => {
    const batch = { checks: checks(1200), metrics: metrics(700) };
    const chunks = chunkBatch(batch, INGEST_MAX_ITEMS_PER_BATCH);

    expect(chunks).toHaveLength(3); // ceil(1200/500)
    for (const c of chunks) {
      expect(c.checks!.length).toBeLessThanOrEqual(INGEST_MAX_ITEMS_PER_BATCH);
      expect(c.metrics!.length).toBeLessThanOrEqual(INGEST_MAX_ITEMS_PER_BATCH);
    }
    expect(chunks.flatMap((c) => c.checks!)).toEqual(batch.checks);
    expect(chunks.flatMap((c) => c.metrics!)).toEqual(batch.metrics);
  });

  it('stays at or under the API caps it is paired with', () => {
    // The server (ingest.dto.ts) caps checks and metrics at 1000 each; the agent chunks at half.
    expect(INGEST_MAX_ITEMS_PER_BATCH).toBeLessThanOrEqual(1000);
  });

  it('yields a single empty chunk for an empty cycle', () => {
    expect(chunkBatch({ checks: [], metrics: [] }, 500)).toEqual([{ checks: [], metrics: [] }]);
  });
});

describe('splitBatch', () => {
  it('returns null when there is nothing left to split', () => {
    expect(splitBatch({ checks: [{ deviceId: 'd', ok: true }], metrics: [] })).toBeNull();
    expect(splitBatch({ checks: [], metrics: [] })).toBeNull();
  });

  it('always makes BOTH halves strictly smaller (so the 413 retry loop terminates)', () => {
    const cases: IngestBatchDto[] = [
      { checks: checks(1), metrics: metrics(1) }, // the awkward one: must not return {1,1} + {}
      { checks: checks(2), metrics: [] },
      { checks: [], metrics: metrics(3) },
      { checks: checks(7), metrics: metrics(4) },
    ];
    for (const b of cases) {
      const halves = splitBatch(b)!;
      expect(halves).not.toBeNull();
      for (const h of halves) {
        expect(items(h)).toBeGreaterThan(0);
        expect(items(h)).toBeLessThan(items(b));
      }
      expect(items(halves[0]) + items(halves[1])).toBe(items(b)); // lossless
    }
  });
});
