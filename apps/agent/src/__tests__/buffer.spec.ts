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
});
