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
  it('throws on a 401 (revoked)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const c = createAgentClient({ apiUrl: 'http://h/api', token: 'x', fetchImpl: f });
    await expect(c.heartbeat()).rejects.toThrow(/401/);
  });
});
