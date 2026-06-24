/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  useDeviceMetricNames,
  useDeviceMetricSeries,
  useDeviceStatusEvents,
} from '../use-device-telemetry';
import * as clientsModule from '../../../data/clients';
import { WS_EVENTS } from '@nodescope/shared';

function makeFakeRealtime() {
  const handlers: Record<string, Set<Function>> = {};
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!handlers[event]) handlers[event] = new Set();
      handlers[event].add(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      handlers[event]?.delete(handler);
    }),
    emit(event: string, payload: unknown) {
      handlers[event]?.forEach((h) => h(payload));
    },
  };
}

beforeEach(() => {
  vi.spyOn(clientsModule, 'getClients').mockReturnValue(null as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── useDeviceMetricNames ────────────────────────────────────────────────────

describe('useDeviceMetricNames', () => {
  it('resolves metric names from the REST client', async () => {
    const rest = { getDeviceMetricNames: vi.fn().mockResolvedValue(['cpu', 'mem']) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest } as any);

    const { result } = renderHook(() => useDeviceMetricNames('d1'));

    expect(result.current.loading).toBe(true);
    await act(async () => {});
    expect(result.current.names).toEqual(['cpu', 'mem']);
    expect(result.current.loading).toBe(false);
  });

  it('returns empty names when no client is set (null-client guard)', () => {
    vi.spyOn(clientsModule, 'getClients').mockReturnValue(null as any);
    const { result } = renderHook(() => useDeviceMetricNames('d1'));
    expect(result.current.names).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('does not throw when REST call fails', async () => {
    const rest = { getDeviceMetricNames: vi.fn().mockRejectedValue(new Error('net')) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest } as any);

    const { result } = renderHook(() => useDeviceMetricNames('d1'));
    await act(async () => {});
    expect(result.current.names).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

// ── useDeviceMetricSeries ───────────────────────────────────────────────────

describe('useDeviceMetricSeries', () => {
  it('loads the series from REST and maps {bucket,avg} → {t,v}', async () => {
    const bucket = new Date(Date.now() - 30_000).toISOString();
    const rest = {
      getDeviceMetrics: vi.fn().mockResolvedValue([{ bucket, avg: 42 }]),
    };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest, realtime: null } as any);

    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000));
    await act(async () => {});

    expect(result.current.points).toHaveLength(1);
    expect(result.current.points[0].t).toBe(new Date(bucket).getTime());
    expect(result.current.points[0].v).toBe(42);
  });

  it('live-appends a matching METRICS_UPDATE point', async () => {
    const rt = makeFakeRealtime();
    const rest = { getDeviceMetrics: vi.fn().mockResolvedValue([]) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest, realtime: rt } as any);

    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000));
    await act(async () => {});

    const now = Date.now();
    act(() => {
      rt.emit(WS_EVENTS.METRICS_UPDATE, { deviceId: 'd1', metric: 'cpu', value: 99, time: new Date(now).toISOString() });
    });

    expect(result.current.points).toHaveLength(1);
    expect(result.current.points[0].v).toBe(99);
  });

  it('ignores a METRICS_UPDATE for a different device', async () => {
    const rt = makeFakeRealtime();
    const rest = { getDeviceMetrics: vi.fn().mockResolvedValue([]) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest, realtime: rt } as any);

    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000));
    await act(async () => {});

    act(() => {
      rt.emit(WS_EVENTS.METRICS_UPDATE, { deviceId: 'OTHER', metric: 'cpu', value: 99, time: new Date().toISOString() });
    });

    expect(result.current.points).toHaveLength(0);
  });

  it('ignores a METRICS_UPDATE for a different metric', async () => {
    const rt = makeFakeRealtime();
    const rest = { getDeviceMetrics: vi.fn().mockResolvedValue([]) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest, realtime: rt } as any);

    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000));
    await act(async () => {});

    act(() => {
      rt.emit(WS_EVENTS.METRICS_UPDATE, { deviceId: 'd1', metric: 'mem', value: 55, time: new Date().toISOString() });
    });

    expect(result.current.points).toHaveLength(0);
  });

  it('drops points older than windowMs on live append', async () => {
    const rt = makeFakeRealtime();
    const oldTime = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    const rest = { getDeviceMetrics: vi.fn().mockResolvedValue([{ bucket: oldTime, avg: 1 }]) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest, realtime: rt } as any);

    // windowMs = 5s — the old point (10s) should be trimmed on live append
    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 5_000));
    await act(async () => {});

    // Old point is retained during initial load (windowMs is applied when appending)
    act(() => {
      rt.emit(WS_EVENTS.METRICS_UPDATE, {
        deviceId: 'd1',
        metric: 'cpu',
        value: 77,
        time: new Date().toISOString(),
      });
    });

    // Only the fresh point should remain (old one outside window is trimmed)
    const points = result.current.points;
    expect(points.every((p) => p.t >= Date.now() - 5_000)).toBe(true);
    expect(points.some((p) => p.v === 77)).toBe(true);
  });

  it('returns empty points when no client is set (null-client guard)', () => {
    vi.spyOn(clientsModule, 'getClients').mockReturnValue(null as any);
    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000));
    expect(result.current.points).toEqual([]);
  });

  it('unsubscribes realtime listener on unmount', async () => {
    const rt = makeFakeRealtime();
    const rest = { getDeviceMetrics: vi.fn().mockResolvedValue([]) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest, realtime: rt } as any);

    const { unmount } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000));
    await act(async () => {});
    unmount();

    expect(rt.off).toHaveBeenCalledWith(WS_EVENTS.METRICS_UPDATE, expect.any(Function));
  });
});

// ── useDeviceStatusEvents ───────────────────────────────────────────────────

describe('useDeviceStatusEvents', () => {
  it('loads status events from REST', async () => {
    const events = [
      { time: '2026-01-01T00:00:00Z', state: 'DOWN', source: 'prober' },
      { time: '2026-01-01T00:01:00Z', state: 'UP', source: 'prober' },
    ];
    const rest = { getDeviceStatusEvents: vi.fn().mockResolvedValue(events) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest } as any);

    const { result } = renderHook(() => useDeviceStatusEvents('d1'));
    await act(async () => {});

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].state).toBe('DOWN');
    expect(result.current.events[1].state).toBe('UP');
  });

  it('returns empty events when no client is set (null-client guard)', () => {
    vi.spyOn(clientsModule, 'getClients').mockReturnValue(null as any);
    const { result } = renderHook(() => useDeviceStatusEvents('d1'));
    expect(result.current.events).toEqual([]);
  });

  it('does not throw when REST call fails', async () => {
    const rest = { getDeviceStatusEvents: vi.fn().mockRejectedValue(new Error('net')) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest } as any);

    const { result } = renderHook(() => useDeviceStatusEvents('d1'));
    await act(async () => {});
    expect(result.current.events).toEqual([]);
  });
});
