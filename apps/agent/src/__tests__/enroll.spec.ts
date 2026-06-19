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
});
