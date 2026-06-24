/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  useDeviceMetricNames,
  useDeviceMetricSeries,
  useDeviceStatusEvents,
} from '../use-device-telemetry';
import * as clientsModule from '../../../data/clients';

beforeEach(() => {
  vi.spyOn(clientsModule, 'getClients').mockReturnValue(null as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── useDeviceMetricNames ────────────────────────────────────────────────────

describe('useDeviceMetricNames', () => {
  it('starts with loading=true and resolves metric names from the REST client', async () => {
    const rest = { getDeviceMetricNames: vi.fn().mockResolvedValue(['cpu', 'mem']) };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest } as any);

    const { result } = renderHook(() => useDeviceMetricNames('d1'));

    expect(result.current.loading).toBe(true);
    await act(async () => {});
    expect(result.current.names).toEqual(['cpu', 'mem']);
    expect(result.current.loading).toBe(false);
  });

  it('returns empty names and loading=false when no client is set (null-client guard)', () => {
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
  it('loads the series from REST on mount and maps {bucket,avg} → {t,v}', async () => {
    const bucket = new Date(Date.now() - 30_000).toISOString();
    const rest = {
      getDeviceMetrics: vi.fn().mockResolvedValue([{ bucket, avg: 42 }]),
    };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest } as any);

    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000));
    await act(async () => {});

    expect(result.current.points).toHaveLength(1);
    expect(result.current.points[0].t).toBe(new Date(bucket).getTime());
    expect(result.current.points[0].v).toBe(42);
  });

  it('returns empty points when no client is set (null-client guard)', () => {
    vi.spyOn(clientsModule, 'getClients').mockReturnValue(null as any);
    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000));
    expect(result.current.points).toEqual([]);
  });

  it('polls and replaces points on interval tick', async () => {
    vi.useFakeTimers();

    const bucketA = new Date(Date.now() - 30_000).toISOString();
    const bucketB = new Date(Date.now() - 10_000).toISOString();
    const seriesA = [{ bucket: bucketA, avg: 10 }];
    const seriesB = [{ bucket: bucketB, avg: 99 }];

    const getDeviceMetrics = vi.fn()
      .mockResolvedValueOnce(seriesA)
      .mockResolvedValueOnce(seriesB);

    const rest = { getDeviceMetrics };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest } as any);

    const pollMs = 15_000;
    const { result } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000, pollMs));

    // Flush the initial load promise
    await act(async () => {});

    expect(result.current.points).toHaveLength(1);
    expect(result.current.points[0].v).toBe(10);

    // Advance past poll interval and flush second call
    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollMs);
    });

    expect(getDeviceMetrics).toHaveBeenCalledTimes(2);
    expect(result.current.points).toHaveLength(1);
    expect(result.current.points[0].v).toBe(99);
  });

  it('clears interval on unmount (no further calls after unmount)', async () => {
    vi.useFakeTimers();

    const getDeviceMetrics = vi.fn().mockResolvedValue([]);
    const rest = { getDeviceMetrics };
    vi.spyOn(clientsModule, 'getClients').mockReturnValue({ rest } as any);

    const pollMs = 15_000;
    const { unmount } = renderHook(() => useDeviceMetricSeries('d1', 'cpu', 60_000, pollMs));

    // Flush the initial load promise
    await act(async () => {});

    expect(getDeviceMetrics).toHaveBeenCalledTimes(1);

    unmount();

    // Advance timers — interval should be cleared so no more calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollMs * 3);
    });

    expect(getDeviceMetrics).toHaveBeenCalledTimes(1);
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
