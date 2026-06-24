import { useMemo, useState } from 'react';
import { useViewportStore } from '../../stores/viewport-store';
import { STATUS_COLOR } from '../nodes/node-status';
import { healthCounts, sortedNodes, byFloor } from '../ops/health-model';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Docked, collapsible NOC triage HUD over the 3D scene. Reads the live store; no API calls. */
export function OpsHud() {
  const devices = useViewportStore((s) => s.devices);
  const nodeStatus = useViewportStore((s) => s.nodeStatus);
  const selection = useViewportStore((s) => s.selection);
  const selectNode = useViewportStore((s) => s.selectNode);
  const requestFocus = useViewportStore((s) => s.requestFocus);

  const [open, setOpen] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [grouped, setGrouped] = useState(false);

  const counts = useMemo(() => healthCounts(devices, nodeStatus), [devices, nodeStatus]);
  const list = useMemo(
    () => sortedNodes(devices, nodeStatus, { problemsOnly }),
    [devices, nodeStatus, problemsOnly],
  );
  const floors = useMemo(() => (grouped ? byFloor(devices, nodeStatus) : []), [grouped, devices, nodeStatus]);

  const flyTo = (id: string) => {
    selectNode(id);
    requestFocus();
  };
  const dot = (status: keyof typeof STATUS_COLOR | string) => (
    <span style={{ color: hex(STATUS_COLOR[status as 'up'] ?? STATUS_COLOR.unknown) }}>●</span>
  );
  const row = (n: { device: { id: string; name: string }; status: string }) => {
    const sel = selection?.kind === 'device' && selection.deviceId === n.device.id;
    return (
      <li key={n.device.id}>
        <button
          aria-label={`ops-row ${n.device.name}`}
          aria-pressed={sel}
          onClick={() => flyTo(n.device.id)}
          style={{ display: 'flex', gap: 6, width: '100%', textAlign: 'left', alignItems: 'center' }}
        >
          {dot(n.status)}
          <span style={{ flex: 1 }}>{n.device.name}</span>
        </button>
      </li>
    );
  };

  return (
    <section
      aria-label="ops-hud"
      style={{ position: 'absolute', top: 44, left: 8, zIndex: 10, background: 'rgba(20,20,24,0.9)', color: '#fff',
               borderRadius: 6, padding: 8, minWidth: 200, maxHeight: '60%', display: 'flex', flexDirection: 'column' }}
    >
      <button
        aria-label="toggle-ops-hud"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'none', color: '#fff', border: 0 }}
      >
        <span aria-label="down-count" style={{ color: hex(STATUS_COLOR.down) }}>● {counts.down} down</span>
        <span aria-label="warning-count" style={{ color: hex(STATUS_COLOR.warning) }}>▲ {counts.warning} warning</span>
      </button>

      {open && (
        <>
          <div style={{ display: 'flex', gap: 8, fontSize: 12, margin: '4px 0' }}>
            <label><input aria-label="problems-only" type="checkbox" checked={problemsOnly}
              onChange={(e) => setProblemsOnly(e.target.checked)} /> Problems only</label>
            <label><input aria-label="by-floor" type="checkbox" checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)} /> By floor</label>
          </div>
          <div style={{ overflow: 'auto' }}>
            {grouped ? (
              floors.map((f) => (
                <div key={f.label}>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {f.label} — <span style={{ color: hex(STATUS_COLOR.down) }}>{f.counts.down}</span>/
                    <span style={{ color: hex(STATUS_COLOR.warning) }}>{f.counts.warning}</span>
                  </div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {(problemsOnly ? f.nodes.filter((n) => n.status === 'down' || n.status === 'warning') : f.nodes).map(row)}
                  </ul>
                </div>
              ))
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{list.map(row)}</ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
