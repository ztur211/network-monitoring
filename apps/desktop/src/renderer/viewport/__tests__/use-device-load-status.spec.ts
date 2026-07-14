import { describe, it, expect, beforeEach } from 'vitest';
import { applyStatusEvent, loadStatusFor } from '../use-device-load';
import { useViewportStore, initialViewportState } from '../../stores/viewport-store';

// merge-reset (NOT replace:true - that would wipe the store's action fns, incl. setNodeStatus)
beforeEach(() => useViewportStore.setState(initialViewportState()));

// nodeStatus is an overlay on the loaded devices, so a status only lands for a device in the list.
const load = (...ids: string[]) =>
  useViewportStore.getState().setDevices(ids.map((id) => ({ id, name: id }) as never));

describe('Spec 7 status wiring', () => {
  it('loadStatusFor seeds nodeStatus from the API (mapping state -> NodeStatus)', async () => {
    load('a', 'b', 'c');
    const rest = {
      getBuildingDeviceStatus: async () => [
        { deviceId: 'a', state: 'DOWN' as const },
        { deviceId: 'b', state: 'UP' as const },
        { deviceId: 'c', state: 'WARNING' as const },
      ],
    };
    await loadStatusFor('bld', rest, () => true);
    const { nodeStatus } = useViewportStore.getState();
    expect(nodeStatus.get('a')).toBe('down');
    expect(nodeStatus.get('b')).toBe('up');
    expect(nodeStatus.get('c')).toBe('warning');
  });

  it('discards a stale load (building switched)', async () => {
    load('a');
    const rest = { getBuildingDeviceStatus: async () => [{ deviceId: 'a', state: 'DOWN' as const }] };
    await loadStatusFor('bld', rest, () => false);
    expect(useViewportStore.getState().nodeStatus.has('a')).toBe(false);
  });

  it('swallows API errors (markers stay unknown)', async () => {
    load('a');
    const rest = {
      getBuildingDeviceStatus: async () => {
        throw new Error('500');
      },
    };
    await expect(loadStatusFor('bld', rest, () => true)).resolves.toBeUndefined();
    expect(useViewportStore.getState().nodeStatus.size).toBe(0);
  });

  it('applyStatusEvent maps a realtime event to NodeStatus', () => {
    load('a');
    applyStatusEvent({ deviceId: 'a', state: 'WARNING' });
    expect(useViewportStore.getState().nodeStatus.get('a')).toBe('warning');
  });

  it('ignores status for a device outside the open building (events fan out for the whole scope)', () => {
    load('a');
    applyStatusEvent({ deviceId: 'other-building-device', state: 'DOWN' });
    const { nodeStatus } = useViewportStore.getState();
    expect(nodeStatus.has('other-building-device')).toBe(false);
    expect(nodeStatus.size).toBe(0);
  });
});
