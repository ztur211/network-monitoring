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

  it('aborts a hung request after the timeout and throws a TIMEOUT ApiError', async () => {
    vi.useFakeTimers();
    // fetch that never settles on its own, but rejects once its abort signal fires.
    const fetchSpy = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const client = createRestClient({ baseUrl: 'http://api', getToken: () => null, timeoutMs: 5_000 });

    const p = client.getOrganization();
    const expectation = expect(p).rejects.toMatchObject({ code: 'TIMEOUT', status: 0 });
    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
    await expect(p).rejects.toBeInstanceOf(ApiError);
    vi.useRealTimers();
  });

  describe('model import methods', () => {
    it('uploadModelVersion POSTs raw bytes as octet-stream with the fileName query', async () => {
      const version = { id: 'ver-1', versionNumber: 2, fileName: 'house.ifc' };
      const fetchSpy = mockFetch(201, { success: true, data: version });
      vi.stubGlobal('fetch', fetchSpy);
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
      const bytes = new TextEncoder().encode('ISO-10303-21;').buffer;
      const result = await client.uploadModelVersion('prop-1', 'house.ifc', bytes);
      expect(result).toEqual(version);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'http://api/v1/buildings/prop-1/model/versions?fileName=house.ifc',
      );
      const init = fetchSpy.mock.calls[0][1];
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/octet-stream');
      expect(init.headers.Authorization).toBe('Bearer TKN');
      expect(init.body).toBe(bytes);
    });

    it('uploadModelVersion appends the units query when provided', async () => {
      const fetchSpy = mockFetch(201, { success: true, data: { id: 'ver-2' } });
      vi.stubGlobal('fetch', fetchSpy);
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => null });
      await client.uploadModelVersion('prop-1', 'a b.ifc', new ArrayBuffer(0), 'METRE');
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'http://api/v1/buildings/prop-1/model/versions?fileName=a%20b.ifc&units=METRE',
      );
    });

    it('uploadModelVersion throws ApiError on an error envelope', async () => {
      vi.stubGlobal('fetch', mockFetch(403, { success: false, error: { code: 'ORG_003', message: 'no' } }));
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => null });
      await expect(
        client.uploadModelVersion('prop-1', 'house.ifc', new ArrayBuffer(0)),
      ).rejects.toMatchObject({ code: 'ORG_003', status: 403 });
    });

    it('activateModelVersion PUTs the versionId to the active route', async () => {
      const model = { id: 'model-1', activeVersionId: 'ver-1' };
      const fetchSpy = mockFetch(200, { success: true, data: model });
      vi.stubGlobal('fetch', fetchSpy);
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
      const result = await client.activateModelVersion('prop-1', 'ver-1');
      expect(result).toEqual(model);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://api/v1/buildings/prop-1/model/active');
      expect(fetchSpy.mock.calls[0][1].method).toBe('PUT');
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ versionId: 'ver-1' });
    });
  });

  describe('BCF methods', () => {
    it('listBcfTopics GETs the building route and unwraps data', async () => {
      const topics = [{ id: 'topic-1', title: 'Test topic' }];
      const fetchSpy = mockFetch(200, { success: true, data: topics });
      vi.stubGlobal('fetch', fetchSpy);
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
      const result = await client.listBcfTopics('building-123');
      expect(result).toEqual(topics);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://api/v1/buildings/building-123/bcf/topics');
      expect(fetchSpy.mock.calls[0][1].method).toBe('GET');
    });

    it('createBcfTopic POSTs to the building route and unwraps data', async () => {
      const newTopic = { id: 'topic-2', title: 'New topic' };
      const fetchSpy = mockFetch(201, { success: true, data: newTopic });
      vi.stubGlobal('fetch', fetchSpy);
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
      const result = await client.createBcfTopic('building-456', { title: 'New topic' });
      expect(result).toEqual(newTopic);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://api/v1/buildings/building-456/bcf/topics');
      expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({ title: 'New topic' });
    });

    it('getBcfTopic GETs the topic route', async () => {
      const topic = { id: 'topic-3', title: 'Single topic' };
      const fetchSpy = mockFetch(200, { success: true, data: topic });
      vi.stubGlobal('fetch', fetchSpy);
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
      const result = await client.getBcfTopic('topic-3');
      expect(result).toEqual(topic);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://api/v1/bcf/topics/topic-3');
      expect(fetchSpy.mock.calls[0][1].method).toBe('GET');
    });

    it('patchBcfTopic PATCHes the topic route', async () => {
      const patchedTopic = { id: 'topic-4', title: 'Patched' };
      const fetchSpy = mockFetch(200, { success: true, data: patchedTopic });
      vi.stubGlobal('fetch', fetchSpy);
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
      const result = await client.patchBcfTopic('topic-4', { baseVersion: 1, topicStatus: 'Closed' });
      expect(result).toEqual(patchedTopic);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://api/v1/bcf/topics/topic-4');
      expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
    });

    it('addBcfComment POSTs to the comments sub-route', async () => {
      const fetchSpy = mockFetch(200, { success: true, data: undefined });
      vi.stubGlobal('fetch', fetchSpy);
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
      await client.addBcfComment('topic-5', { comment: 'Looks good' });
      expect(fetchSpy.mock.calls[0][0]).toBe('http://api/v1/bcf/topics/topic-5/comments');
      expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
    });

    it('exportBcfUrl returns the download URL string without fetching', () => {
      const client = createRestClient({ baseUrl: 'http://api', getToken: () => 'TKN' });
      expect(client.exportBcfUrl('building-789')).toBe('http://api/v1/buildings/building-789/bcf/export');
    });
  });
});
