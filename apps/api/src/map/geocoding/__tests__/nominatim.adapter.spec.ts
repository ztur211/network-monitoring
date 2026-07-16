// reflect-metadata is needed because NominatimAdapter is an @Injectable class
// and this spec does not import @nestjs/core (which would pull it in).
import 'reflect-metadata';
import { NominatimAdapter } from '../nominatim.adapter';

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

describe('NominatimAdapter', () => {
  let adapter: NominatimAdapter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    adapter = new NominatimAdapter();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('geocode', () => {
    it('maps a successful first result into a GeocodingResult', async () => {
      fetchMock.mockResolvedValue(
        okResponse([
          { lat: '40.7128', lon: '-74.0060', display_name: 'New York, NY' },
        ]),
      );

      const result = await adapter.geocode('New York');

      expect(result).toEqual({
        latitude: 40.7128,
        longitude: -74.006,
        displayName: 'New York, NY',
      });
    });

    it('sends the configured User-Agent and a url-encoded query', async () => {
      fetchMock.mockResolvedValue(
        okResponse([{ lat: '1', lon: '2', display_name: 'x' }]),
      );

      await adapter.geocode('123 Main St, Anytown');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('q=123%20Main%20St%2C%20Anytown');
      expect(url).toContain('format=json');
      expect(url).toContain('limit=1');
      expect(init.headers['User-Agent']).toBeDefined();
      expect(init.headers.Accept).toBe('application/json');
    });

    it('returns null when the response is not OK', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => [] });

      expect(await adapter.geocode('anywhere')).toBeNull();
    });

    it('returns null when fetch throws', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      expect(await adapter.geocode('anywhere')).toBeNull();
    });

    it('returns null when the result list is empty', async () => {
      fetchMock.mockResolvedValue(okResponse([]));

      expect(await adapter.geocode('nowhere')).toBeNull();
    });

    it('aborts and returns null when response body consumption stalls', async () => {
      jest.useFakeTimers();
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      }));

      const pending = adapter.geocode('stalled');
      const expectation = expect(pending).resolves.toBeNull();
      await jest.advanceTimersByTimeAsync(10_000);
      await expectation;
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('rate limiting', () => {
    it('does not wait on the very first request', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      fetchMock.mockResolvedValue(
        okResponse([{ lat: '1', lon: '2', display_name: 'x' }]),
      );

      await adapter.geocode('first');

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
    });

    it('spaces a back-to-back request by at least the minimum interval', async () => {
      fetchMock.mockResolvedValue(
        okResponse([{ lat: '1', lon: '2', display_name: 'x' }]),
      );

      // Pin Date.now so the second call sees a tiny elapsed gap and must wait.
      // First call: huge elapsed (now - lastRequestAt=0) ⇒ no wait, stamps now.
      // Second call: same `now` ⇒ elapsed 0 ⇒ schedules a ~1100ms timer.
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
      const setTimeoutSpy = jest
        .spyOn(global, 'setTimeout')
        .mockImplementation((cb: (...args: unknown[]) => void) => {
          // Invoke immediately so the test doesn't actually sleep.
          cb();
          return 0 as unknown as ReturnType<typeof setTimeout>;
        });

      await adapter.geocode('first');
      await adapter.geocode('second');

      const rateLimitCalls = setTimeoutSpy.mock.calls.filter((call) => {
        const delay = call[1] as number;
        return delay > 1000 && delay <= 1100;
      });
      expect(rateLimitCalls).toHaveLength(1);
      const delay = rateLimitCalls[0][1] as number;
      expect(delay).toBeGreaterThan(1000);
      expect(delay).toBeLessThanOrEqual(1100);

      nowSpy.mockRestore();
    });
  });
});
