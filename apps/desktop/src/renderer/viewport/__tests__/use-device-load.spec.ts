import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadDevicesFor, applyDeviceEvent } from '../use-device-load';
import { useViewportStore, initialViewportState } from '../../stores/viewport-store';

// merge reset so the store action fns survive
beforeEach(() => useViewportStore.setState(initialViewportState()));
const dev = (id: string, over = {}) =>
  ({ id, name: id, category: 'SWITCH', propertyId: 'b', networkId: 'n', x: null, y: null, z: null, floor: 1, ...over }) as any;

describe('device load', () => {
  it('loadDevicesFor sets the store devices when still current', async () => {
    const rest = { listDevicesForBuilding: vi.fn().mockResolvedValue([dev('a'), dev('b')]) };
    useViewportStore.setState({ activeBuildingPropertyId: 'bld' });
    await loadDevicesFor('bld', rest as any, () => true);
    expect(useViewportStore.getState().devices.map((d: any) => d.id)).toEqual(['a', 'b']);
  });

  it('discards a stale load', async () => {
    const rest = { listDevicesForBuilding: vi.fn().mockResolvedValue([dev('a')]) };
    await loadDevicesFor('bld', rest as any, () => false); // no longer current
    expect(useViewportStore.getState().devices).toEqual([]);
  });

  it('applyDeviceEvent updates only an already-listed device, and removes on delete', () => {
    useViewportStore.getState().setDevices([dev('a')]);
    applyDeviceEvent('updated', dev('a', { x: 1, y: 2, z: 3 }));
    expect(useViewportStore.getState().devices[0].x).toBe(1);
    applyDeviceEvent('updated', dev('foreign')); // not listed → ignored
    expect(useViewportStore.getState().devices.map((d: any) => d.id)).toEqual(['a']);
    applyDeviceEvent('deleted', { id: 'a' });
    expect(useViewportStore.getState().devices).toEqual([]);
  });
});
