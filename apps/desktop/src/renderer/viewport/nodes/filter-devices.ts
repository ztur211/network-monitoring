import type { DeviceDto } from '@nodescope/shared';
import type { NodeStatus } from './node-status';

export interface NodeFilter {
  text: string;
  categories: Set<string>;
  networkId: string | null;
  placement: 'all' | 'placed' | 'unplaced';
  floor: number | null;
  status: NodeStatus | null;
}

export const emptyFilter = (): NodeFilter => ({
  text: '',
  categories: new Set(),
  networkId: null,
  placement: 'all',
  floor: null,
  status: null,
});

const isPlaced = (d: DeviceDto) => d.x !== null && d.y !== null && d.z !== null;

/** Pure: apply the Node-panel filter across every dimension (text/category/network/placement/floor/status). */
export function filterDevices(
  devices: DeviceDto[],
  f: NodeFilter,
  statusOf: (id: string) => NodeStatus,
): DeviceDto[] {
  const t = f.text.trim().toLowerCase();
  return devices.filter((d) => {
    if (t && !`${d.name} ${d.ipAddress ?? ''} ${d.macAddress ?? ''}`.toLowerCase().includes(t)) return false;
    if (f.categories.size && !f.categories.has(d.category)) return false;
    if (f.networkId && d.networkId !== f.networkId) return false;
    if (f.placement === 'placed' && !isPlaced(d)) return false;
    if (f.placement === 'unplaced' && isPlaced(d)) return false;
    if (f.floor !== null && d.floor !== f.floor) return false;
    if (f.status && statusOf(d.id) !== f.status) return false;
    return true;
  });
}
