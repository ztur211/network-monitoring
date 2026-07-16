import { gunzipSync } from 'node:zlib';
import { describe, it, expect, vi } from 'vitest';
import { createAgentClient } from '../api-client.js';

const ok = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data, timestamp: '' }) });

describe('agent api-client', () => {
  it('syncDevices GETs with the agent token', async () => {
    const f = vi.fn().mockResolvedValue(ok([{ id: 'd', name: 'D', ipAddress: '10.0.0.1' }]));
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'tok', fetchImpl: f });
    expect(await c.syncDevices()).toHaveLength(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://h/api/v1/monitoring/agent/devices');
    expect(init.headers['x-agent-token']).toBe('tok');
  });
  it('ingest POSTs the batch', async () => {
    const f = vi.fn().mockResolvedValue(ok({ accepted: 1 }));
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'tok', fetchImpl: f });
    await c.ingest({ checks: [{ deviceId: 'd', ok: true, latencyMs: 5 }], metrics: [] });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://h/api/v1/monitoring/ingest'); expect(init.method).toBe('POST');
  });
  it('gzips a large ingest batch and round-trips to the same JSON', async () => {
    const f = vi.fn().mockResolvedValue(ok({ accepted: 60 }));
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'tok', fetchImpl: f });
    const batch = {
      checks: Array.from({ length: 60 }, (_, i) => ({ deviceId: `device-${i}`, ok: true, latencyMs: i })),
      metrics: [],
    };
    await c.ingest(batch);
    const [, init] = f.mock.calls[0];
    expect(init.headers['content-encoding']).toBe('gzip');
    expect(Buffer.isBuffer(init.body)).toBe(true);
    expect(JSON.parse(gunzipSync(init.body as Buffer).toString())).toEqual(batch);
  });
  it('sends a small ingest batch uncompressed (no content-encoding)', async () => {
    const f = vi.fn().mockResolvedValue(ok({ accepted: 1 }));
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'tok', fetchImpl: f });
    await c.ingest({ checks: [{ deviceId: 'd', ok: true }], metrics: [] });
    const [, init] = f.mock.calls[0];
    expect(init.headers['content-encoding']).toBeUndefined();
    expect(typeof init.body).toBe('string');
  });
  it('throws on a 401 (revoked)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'x', fetchImpl: f });
    await expect(c.heartbeat()).rejects.toThrow(/401/);
  });

  it('aborts when response body consumption exceeds the request deadline', async () => {
    vi.useFakeTimers();
    const f = vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      }),
    );
    const c = createAgentClient({
      apiUrl: 'http://h/api',
      token: 'tok',
      fetchImpl: f as unknown as typeof fetch,
      timeoutMs: 1_000,
    });

    const pending = c.syncDevices();
    const expectation = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
