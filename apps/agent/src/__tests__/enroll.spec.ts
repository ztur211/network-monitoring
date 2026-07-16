import { describe, it, expect, vi } from 'vitest';
import { enroll } from '../enroll.js';

describe('enroll', () => {
  it('POSTs the code and returns credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { agentId: 'a1', token: 'tok' }, timestamp: '' }) });
    const creds = await enroll({ apiUrl: 'http://h/api', code: 'CODE', name: 'edge-1', platform: 'linux', version: '0.0.0', fetchImpl: fetchMock });
    expect(creds).toEqual({ agentId: 'a1', token: 'tok' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://h/api/v1/monitoring/agent/enroll');
    expect(JSON.parse(init.body)).toMatchObject({ code: 'CODE', name: 'edge-1', platform: 'linux' });
  });

  it('aborts enrollment when response body consumption exceeds the deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    }));

    const pending = enroll({
      apiUrl: 'http://h/api', code: 'CODE', name: 'edge-1', platform: 'linux', version: '0.0.0',
      fetchImpl: fetchMock as unknown as typeof fetch, timeoutMs: 1_000,
    });
    const expectation = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
