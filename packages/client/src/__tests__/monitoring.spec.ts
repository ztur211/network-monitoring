import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRestClient } from '../rest-client';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body } as Response);
}

afterEach(() => vi.unstubAllGlobals());

describe('monitoring client methods', () => {
  it('getBuildingDeviceStatus GETs the building endpoint and unwraps data', async () => {
    const fetchSpy = mockFetch(200, {
      success: true,
      data: [{ deviceId: 'd', state: 'UP' }],
      timestamp: 't',
    });
    vi.stubGlobal('fetch', fetchSpy);
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    const out = await client.getBuildingDeviceStatus('bld-1');
    expect(out).toEqual([{ deviceId: 'd', state: 'UP' }]);
    expect(fetchSpy.mock.calls[0][0]).toContain('/v1/buildings/bld-1/device-status');
  });

  it('getDeviceMetrics encodes the metric/from/to/bucket query', async () => {
    const fetchSpy = mockFetch(200, { success: true, data: [{ bucket: 't0', avg: 12 }], timestamp: 't' });
    vi.stubGlobal('fetch', fetchSpy);
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
    const out = await client.getDeviceMetrics('d1', 'latency_ms', 'F', 'T', '5 minutes');
    expect(out).toEqual([{ bucket: 't0', avg: 12 }]);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/v1/devices/d1/metrics?metric=latency_ms&from=F&to=T&bucket=5%20minutes');
  });
});
