import { describe, it, expect, vi } from 'vitest';
import { createRestClient } from '../rest-client';
import { ApiError } from '../api-error';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body } as Response);
}

describe('createRestClient', () => {
  it('attaches the bearer token and unwraps { data }', async () => {
    const fetchSpy = mockFetch(200, { success: true, data: { id: 'org1' }, timestamp: 't' });
    vi.stubGlobal('fetch', fetchSpy);
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    const org = await client.getOrganization();
    expect(org).toEqual({ id: 'org1' });
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer TKN');
  });

  it('throws ApiError on an error envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { success: false, error: { code: 'ORG_003', message: 'x' } }));
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => null });
    await expect(client.listProperties()).rejects.toMatchObject({ code: 'ORG_003', status: 403 });
    await expect(client.listProperties()).rejects.toBeInstanceOf(ApiError);
  });
});
