import { useState, useEffect } from 'react';
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
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const rest = getClients()?.rest;
    if (!rest) {
      setLoading(false);
      return;
    }

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
  pollMs = 15000,
): { points: MetricPoint[] } {
  const [points, setPoints] = useState<MetricPoint[]>([]);

  useEffect(() => {
    const rest = getClients()?.rest;
    if (!rest || !deviceId || !metric) {
      setPoints([]);
      return;
    }

    let active = true;

    const load = () => {
      const now = new Date();
      const fromISO = new Date(now.getTime() - windowMs).toISOString();
      const toISO = now.toISOString();

      rest
        .getDeviceMetrics(deviceId, metric, fromISO, toISO)
        .then((rows) => {
          if (!active) return;
          setPoints(rows.map((r) => ({ t: new Date(r.bucket).getTime(), v: r.avg })));
        })
        .catch(() => {
          // swallow errors — keep last points
        });
    };

    load();
    const id = setInterval(load, pollMs);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [deviceId, metric, windowMs, pollMs]);

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
