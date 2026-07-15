/**
 * Regression tests for the collector's resource-runaway bug: a 30s `setInterval`
 * whose body was unbounded. The two bandwidth `fetch` calls had no AbortController,
 * so against an origin that accepts the connection and never answers they hung
 * forever, the next tick stacked a second cycle on top of the first, and every
 * in-flight cycle held its own buffers and its own slots in the browser's
 * 6-connections-per-origin budget.
 *
 * Covers: the overlap guard, the per-probe timeout, the rejection that must not
 * escape the interval callback, and the reported rates themselves (a failed probe
 * has to report *no* measurement rather than a rate derived from how fast it failed).
 *
 * The collector's collaborators are used for real and spied on, not module-mocked:
 * `jest.unstable_mockModule` resolves its specifier relative to the module owning the
 * `jest` object, which under this suite's ESM setup is jest.setup.ts, not the spec.
 */
import { WS_EVENTS } from '@nodescope/shared';

const COLLECT_INTERVAL_MS = 30_000;
const BANDWIDTH_TIMEOUT_MS = 10_000;
const LATENCY_TIMEOUT_MS = 5_000;
const DOWNLOAD_BYTES = 1_000_000;
const DEVICE_ID = 'browser-device-1';

interface Harness {
  start: () => void;
  stop: () => void;
  emit: jest.Mock;
}

/**
 * Fresh module instances per test: the collector is a module-level singleton and its
 * overlap guard is part of that instance, so one test's in-flight cycle must not be
 * inherited by the next. websocket.service is imported first so the collector binds to
 * the same fresh instance we spy on.
 */
async function loadCollector(): Promise<Harness> {
  jest.resetModules();
  const { websocketService } = await import('../websocket.service');
  const { browserCollectorService } = await import('../browser-collector.service');
  const emit = jest.spyOn(websocketService, 'emit').mockImplementation(() => {}) as unknown as jest.Mock;
  return {
    start: () => browserCollectorService.start(),
    stop: () => browserCollectorService.stop(),
    emit,
  };
}

/** A fetch that never answers. `honorAbort` distinguishes a server that respects the
 *  AbortController from a hang the guard alone has to contain. */
function hangingFetch(honorAbort: boolean): jest.Mock {
  return jest.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (!honorAbort) return;
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
}

function okResponse(bytes: number): Response {
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(bytes) } as unknown as Response;
}

function respondAfter(ms: number, response: Response): Promise<Response> {
  return new Promise((resolve) => setTimeout(() => resolve(response), ms));
}

function lastMetricsPayload(emit: jest.Mock): Record<string, unknown> {
  const submits = emit.mock.calls.filter(([event]) => event === WS_EVENTS.METRICS_SUBMIT);
  return submits[submits.length - 1][1];
}

/** Drive one whole cycle: the tick, both bandwidth probes, and the latency ping that
 *  nothing ever pongs. */
async function runOneCycle(probeMs: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(COLLECT_INTERVAL_MS);
  await jest.advanceTimersByTimeAsync(probeMs); // download
  await jest.advanceTimersByTimeAsync(probeMs); // upload
  await jest.advanceTimersByTimeAsync(LATENCY_TIMEOUT_MS);
}

describe('BrowserCollectorService', () => {
  let harness: Harness;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    globalThis.document = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      visibilityState: 'visible',
    } as unknown as Document;

    // The collector tags each submission with the persisted browser device id.
    globalThis.localStorage = {
      getItem: () => DEVICE_ID,
      setItem: () => {},
    } as unknown as Storage;

    harness = await loadCollector();
  });

  afterEach(() => {
    harness.stop();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('skips a tick instead of stacking a second cycle on a stalled one', async () => {
    // A hang the timeout cannot reach: only the overlap guard stands between this and
    // an unbounded pileup.
    const fetchMock = hangingFetch(false);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    harness.start();
    await jest.advanceTimersByTimeAsync(COLLECT_INTERVAL_MS * 3);

    // Three ticks fired, and the first cycle - still in flight - is still the only one
    // holding a connection. Before the guard this was three concurrent cycles.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('previous cycle still in flight'));
  });

  it('aborts a bandwidth probe that hangs, well inside the collect interval', async () => {
    const fetchMock = hangingFetch(true);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    harness.start();
    await runOneCycle(BANDWIDTH_TIMEOUT_MS);

    // Both probes were issued and both were aborted, so the cycle completed - with no
    // bandwidth to report - rather than hanging for the life of the tab.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(lastMetricsPayload(harness.emit)).toEqual({ browserDeviceId: DEVICE_ID });

    // Having finished, the cycle released the guard: the next tick runs rather than
    // being skipped as an overlap.
    const probesSoFar = fetchMock.mock.calls.length;
    await jest.advanceTimersByTimeAsync(COLLECT_INTERVAL_MS);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(probesSoFar);
  });

  it('reports the measured rates when both probes succeed', async () => {
    const fetchMock = jest.fn((_url: string, init?: RequestInit) =>
      respondAfter(50, okResponse(init?.method === 'POST' ? 0 : DOWNLOAD_BYTES)),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    harness.start();
    await runOneCycle(50);

    const payload = lastMetricsPayload(harness.emit);
    expect(payload.bandwidthDown).toBe(160); // 1 MB in 50ms
    expect(payload.bandwidthUp).toBe(16); // 100 KB in 50ms
  });

  it('reports no upload rate when the upload probe fails', async () => {
    // The old code timed the *failure* and reported it as throughput: a connection
    // refused in 1ms became a ~800 Mbps upload.
    const fetchMock = jest.fn((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : respondAfter(50, okResponse(DOWNLOAD_BYTES)),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    harness.start();
    await runOneCycle(50);

    const payload = lastMetricsPayload(harness.emit);
    expect(payload.bandwidthDown).toBe(160);
    expect(payload).not.toHaveProperty('bandwidthUp');
  });

  it('contains a rejected cycle and keeps collecting', async () => {
    const fetchMock = jest.fn(() => respondAfter(50, okResponse(DOWNLOAD_BYTES)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
    } as unknown as Storage;

    harness.start();
    await runOneCycle(50);

    // The rejection was caught - an unhandled rejection would fail the run - and the
    // guard was released, so the collector recovers on the next tick.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('collection cycle failed'),
      expect.any(Error),
    );
    expect(harness.emit).not.toHaveBeenCalledWith(WS_EVENTS.METRICS_SUBMIT, expect.anything());

    globalThis.localStorage = { getItem: () => DEVICE_ID } as unknown as Storage;
    await runOneCycle(50);
    expect(lastMetricsPayload(harness.emit)).toMatchObject({ browserDeviceId: DEVICE_ID });
  });
});
