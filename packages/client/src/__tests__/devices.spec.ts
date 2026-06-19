import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRestClient } from '../rest-client';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body } as Response);
}

afterEach(() => vi.unstubAllGlobals());

describe('device client methods', () => {
  it('listDevicesForBuilding GETs the scoped query and unwraps data', async () => {
    const fetchSpy = mockFetch(200, { success: true, data: [{ id: 'd' }], timestamp: 't' });
    vi.stubGlobal('fetch', fetchSpy);
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    const out = await client.listDevicesForBuilding('bld-1');
    expect(out).toEqual([{ id: 'd' }]);
    expect(fetchSpy.mock.calls[0][0]).toContain('/v1/devices?buildingPropertyId=bld-1');
  });

  it('setDevicePosition PATCHes /position with the coordinates', async () => {
    const fetchSpy = mockFetch(200, { success: true, data: { id: 'd', x: 1, y: 2, z: 3 }, timestamp: 't' });
    vi.stubGlobal('fetch', fetchSpy);
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    await client.setDevicePosition('d', { x: 1, y: 2, z: 3 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/v1/devices/d/position');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('setDevicePosition(null) clears via explicit nulls', async () => {
    const fetchSpy = mockFetch(200, { success: true, data: { id: 'd' }, timestamp: 't' });
    vi.stubGlobal('fetch', fetchSpy);
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    await client.setDevicePosition('d', null);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string)).toEqual({ x: null, y: null, z: null });
  });
});
