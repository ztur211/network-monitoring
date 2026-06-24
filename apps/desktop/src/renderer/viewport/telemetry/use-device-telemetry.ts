import { useState, useEffect } from 'react';
import { WS_EVENTS } from '@nodescope/shared';
import { getClients } from '../../data/clients';

export interface MetricPoint {
  t: number; // epoch ms
  v: number;
}

export interface StatusEvent {
  time: string;
  state: string;
  source: string;
}

// ── useDeviceMetricNames ────────────────────────────────────────────────────

export function useDeviceMetricNames(deviceId: string): { names: string[]; loading: boolean } {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const rest = getClients()?.rest;
    if (!rest) return;

    let active = true;
    const isCurrent = () => active;

    setLoading(true);
    rest
      .getDeviceMetricNames(deviceId)
      .then((n) => {
        if (isCurrent()) {
          setNames(n);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isCurrent()) {
          setNames([]);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [deviceId]);

  return { names, loading };
}

// ── useDeviceMetricSeries ───────────────────────────────────────────────────

export function useDeviceMetricSeries(
  deviceId: string,
  metric: string,
  windowMs: number,
): { points: MetricPoint[] } {
  const [points, setPoints] = useState<MetricPoint[]>([]);

  // Initial load from REST
  useEffect(() => {
    const rest = getClients()?.rest;
    if (!rest) return;

    let active = true;
    const isCurrent = () => active;

    const now = new Date();
    const fromISO = new Date(now.getTime() - windowMs).toISOString();
    const toISO = now.toISOString();

    rest
      .getDeviceMetrics(deviceId, metric, fromISO, toISO)
      .then((rows) => {
        if (!isCurrent()) return;
        setPoints(rows.map((r) => ({ t: new Date(r.bucket).getTime(), v: r.avg })));
      })
      .catch(() => {
        if (isCurrent()) setPoints([]);
      });

    return () => {
      active = false;
    };
  }, [deviceId, metric, windowMs]);

  // Live-append via realtime
  useEffect(() => {
    const rt = getClients()?.realtime;
    if (!rt) return;

    const handler = (payload: unknown) => {
      const p = payload as { deviceId: string; metric: string; value: number; time: string };
      if (p.deviceId !== deviceId || p.metric !== metric) return;

      const now = Date.now();
      const cutoff = now - windowMs;
      const newPoint: MetricPoint = { t: new Date(p.time).getTime(), v: p.value };

      setPoints((prev) => {
        const trimmed = prev.filter((pt) => pt.t >= cutoff);
        return [...trimmed, newPoint];
      });
    };

    rt.on(WS_EVENTS.METRICS_UPDATE, handler);
    return () => {
      rt.off?.(WS_EVENTS.METRICS_UPDATE, handler);
    };
  }, [deviceId, metric, windowMs]);

  return { points };
}

// ── useDeviceStatusEvents ───────────────────────────────────────────────────

export function useDeviceStatusEvents(deviceId: string): { events: StatusEvent[] } {
  const [events, setEvents] = useState<StatusEvent[]>([]);

  useEffect(() => {
    const rest = getClients()?.rest;
    if (!rest) return;

    let active = true;
    const isCurrent = () => active;

    rest
      .getDeviceStatusEvents(deviceId)
      .then((rows) => {
        if (isCurrent()) setEvents(rows);
      })
      .catch(() => {
        if (isCurrent()) setEvents([]);
      });

    return () => {
      active = false;
    };
  }, [deviceId]);

  return { events };
}
