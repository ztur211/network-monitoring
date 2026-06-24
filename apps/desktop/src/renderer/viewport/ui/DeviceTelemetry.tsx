import { useState } from 'react';
import { useViewportStore } from '../../stores/viewport-store';
import {
  useDeviceMetricNames,
  useDeviceMetricSeries,
  useDeviceStatusEvents,
} from '../telemetry/use-device-telemetry';
import { MetricChart } from '../telemetry/MetricChart';
import { STATUS_COLOR, statusFromState } from '../nodes/node-status';
import type { NodeStatus } from '../nodes/node-status';
import type { DeviceStatusState } from '@nodescope/shared';

const ONE_HOUR_MS = 3_600_000;

function hexColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function MetricSelector({
  names,
  value,
  onChange,
}: {
  names: string[];
  value: string;
  onChange: (name: string) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ccc' }}>
      Metric
      <select
        aria-label="Metric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, background: '#2a2d33', color: '#fff', border: '1px solid #444', borderRadius: 3, padding: '2px 4px', fontSize: 12 }}
      >
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

function TelemetryPanel({ deviceId }: { deviceId: string }) {
  const { names, loading } = useDeviceMetricNames(deviceId);
  const [metric, setMetric] = useState<string>('');

  // Pick the first name when names load and no metric is chosen yet
  const activeName = metric || names[0] || '';

  const { points } = useDeviceMetricSeries(deviceId, activeName, ONE_HOUR_MS);
  const { events } = useDeviceStatusEvents(deviceId);

  return (
    <section
      aria-label="device-telemetry"
      style={{ padding: '8px 10px', borderTop: '1px solid #333', fontSize: 12 }}
    >
      <h4 style={{ margin: '0 0 6px', fontSize: 12, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1 }}>
        Telemetry
      </h4>

      {/* Metric selector + chart */}
      {loading ? (
        <div style={{ color: '#8a8f98' }}>Loading…</div>
      ) : names.length === 0 ? (
        <div style={{ color: '#8a8f98' }}>No metrics yet</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <MetricSelector
            names={names}
            value={activeName}
            onChange={(n) => setMetric(n)}
          />
          <MetricChart points={points} width={280} height={80} />
        </div>
      )}

      {/* Recent events */}
      <h4 style={{ margin: '10px 0 4px', fontSize: 12, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1 }}>
        Recent Events
      </h4>
      {events.length === 0 ? (
        <div style={{ color: '#8a8f98' }}>No recent events</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {events.map((ev) => {
            const mapped = statusFromState(ev.state as DeviceStatusState);
            const color = STATUS_COLOR[mapped] ?? STATUS_COLOR.unknown;
            return (
              <li key={`${ev.time}-${ev.state}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: hexColor(color),
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: hexColor(color), fontWeight: 600 }}>{ev.state}</span>
                <span style={{ color: '#8a8f98', fontSize: 10 }}>
                  {new Date(ev.time).toLocaleTimeString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Renders only when a device is selected; shows metric chart + recent status events. */
export function DeviceTelemetry() {
  const selection = useViewportStore((s) => s.selection);
  if (selection?.kind !== 'device') return null;
  return <TelemetryPanel deviceId={selection.deviceId} />;
}
