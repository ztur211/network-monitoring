import type { DeviceDto } from '@nodescope/shared';
import type { NodeStatus } from '../nodes/node-status';

export type Severity = 0 | 1 | 2 | 3; // up=0, unknown=1, warning=2, down=3
export interface HealthCounts { down: number; warning: number; unknown: number; up: number; total: number; }
export interface NodeHealth { device: DeviceDto; status: NodeStatus; severity: Severity; }
export interface FloorHealth { floor: number | null; label: string; counts: HealthCounts; nodes: NodeHealth[]; }
export interface Emphasis { halo: number; pulse: boolean; }

const SEVERITY: Record<NodeStatus, Severity> = { up: 0, unknown: 1, warning: 2, down: 3 };
const statusOf = (ns: Map<string, NodeStatus>, id: string): NodeStatus => ns.get(id) ?? 'unknown';

export function healthCounts(devices: DeviceDto[], ns: Map<string, NodeStatus>): HealthCounts {
  const c: HealthCounts = { down: 0, warning: 0, unknown: 0, up: 0, total: devices.length };
  for (const d of devices) c[statusOf(ns, d.id)] += 1;
  return c;
}

export function nodeHealth(devices: DeviceDto[], ns: Map<string, NodeStatus>): NodeHealth[] {
  return devices.map((device) => {
    const status = statusOf(ns, device.id);
    return { device, status, severity: SEVERITY[status] };
  });
}

export function sortedNodes(
  devices: DeviceDto[],
  ns: Map<string, NodeStatus>,
  opts: { problemsOnly?: boolean } = {},
): NodeHealth[] {
  let list = nodeHealth(devices, ns);
  if (opts.problemsOnly) list = list.filter((n) => n.status === 'down' || n.status === 'warning');
  return list.sort(
    (a, b) =>
      b.severity - a.severity ||
      (a.device.floor ?? Number.POSITIVE_INFINITY) - (b.device.floor ?? Number.POSITIVE_INFINITY) ||
      a.device.name.localeCompare(b.device.name),
  );
}

export function byFloor(devices: DeviceDto[], ns: Map<string, NodeStatus>): FloorHealth[] {
  const groups = new Map<number | null, NodeHealth[]>();
  for (const n of nodeHealth(devices, ns)) {
    const arr = groups.get(n.device.floor);
    if (arr) arr.push(n);
    else groups.set(n.device.floor, [n]);
  }
  const worst = (c: HealthCounts): Severity => (c.down ? 3 : c.warning ? 2 : c.unknown ? 1 : 0);
  const floors: FloorHealth[] = [];
  for (const [floor, nodes] of groups) {
    const counts = healthCounts(nodes.map((n) => n.device), ns);
    const labelled = nodes.find((n) => n.device.floorLabel != null);
    const label = floor === null ? 'Unassigned' : labelled?.device.floorLabel ?? `Floor ${floor}`;
    nodes.sort((a, b) => b.severity - a.severity || a.device.name.localeCompare(b.device.name));
    floors.push({ floor, label, counts, nodes });
  }
  return floors.sort(
    (a, b) =>
      worst(b.counts) - worst(a.counts) ||
      (a.floor ?? Number.POSITIVE_INFINITY) - (b.floor ?? Number.POSITIVE_INFINITY),
  );
}

/** Marker ring emphasis per status. */
export function emphasisFor(status: NodeStatus): Emphasis {
  if (status === 'down') return { halo: 2.2, pulse: true };
  if (status === 'warning') return { halo: 1.8, pulse: true };
  return { halo: 1.5, pulse: false }; // up/unknown = current baseline ring scale
}
