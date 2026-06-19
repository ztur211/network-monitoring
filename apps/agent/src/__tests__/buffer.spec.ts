import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBuffer } from '../buffer.js';

const path = () => join(mkdtempSync(join(tmpdir(), 'buf-')), 'queue.jsonl');

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
});
