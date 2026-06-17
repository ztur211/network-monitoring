import { useMemo } from 'react';
import { useViewportStore } from '../../stores/viewport-store';
import { filterDevices } from '../nodes/filter-devices';
import { categoryColor } from '../nodes/category-color';
import { STATUS_COLOR, type NodeStatus } from '../nodes/node-status';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const isPlaced = (d: { x: number | null }) => d.x !== null;

/** Right-dock: a filterable, selection-synced list of the building's in-scope devices (the monitoring
 *  surface + placement source). Reads are already F3 scope-filtered server-side. */
export function NodePanel() {
  const { devices, nodeFilter, nodeStatus, selection, selectNode, setNodeFilter } = useViewportStore();
  const statusOf = (id: string): NodeStatus => nodeStatus.get(id) ?? 'unknown';
  const categories = useMemo(() => [...new Set(devices.map((d) => d.category))].sort(), [devices]);
  const rows = useMemo(
    () => filterDevices(devices, nodeFilter, statusOf),
    [devices, nodeFilter, nodeStatus], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <section aria-label="nodes" style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
      <input
        aria-label="Filter devices"
        placeholder="Search name / ip…"
        value={nodeFilter.text}
        onChange={(e) => setNodeFilter({ text: e.target.value })}
      />
      <div style={{ display: 'flex', gap: 4 }}>
        <select
          aria-label="Placement"
          value={nodeFilter.placement}
          onChange={(e) => setNodeFilter({ placement: e.target.value as NodeFilterPlacement })}
        >
          <option value="all">All</option>
          <option value="placed">Placed</option>
          <option value="unplaced">Unplaced</option>
        </select>
        <select
          aria-label="Status"
          value={nodeFilter.status ?? ''}
          onChange={(e) => setNodeFilter({ status: (e.target.value || null) as NodeStatus | null })}
        >
          <option value="">Any status</option>
          <option value="up">Up</option>
          <option value="down">Down</option>
          <option value="warning">Warning</option>
          <option value="unknown">Unknown</option>
        </select>
        <select
          aria-label="Category"
          value=""
          onChange={(e) => {
            const c = e.target.value;
            if (!c) return;
            const n = new Set(nodeFilter.categories);
            if (n.has(c)) n.delete(c);
            else n.add(c);
            setNodeFilter({ categories: n });
          }}
        >
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {nodeFilter.categories.has(c) ? '✓ ' : ''}
              {c}
            </option>
          ))}
        </select>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflow: 'auto' }}>
        {rows.map((d) => {
          const sel = selection?.kind === 'device' && selection.deviceId === d.id;
          return (
            <li key={d.id}>
              <button
                onClick={() => selectNode(d.id)}
                aria-pressed={sel}
                style={{ display: 'flex', gap: 6, width: '100%', textAlign: 'left', alignItems: 'center' }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 5, background: hex(categoryColor(d.category)) }} />
                <span style={{ flex: 1 }}>{d.name}</span>
                <span title={isPlaced(d) ? 'Placed' : 'Unplaced'}>{isPlaced(d) ? '📍' : '○'}</span>
                <span style={{ color: hex(STATUS_COLOR[statusOf(d.id)]) }}>●</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type NodeFilterPlacement = 'all' | 'placed' | 'unplaced';
