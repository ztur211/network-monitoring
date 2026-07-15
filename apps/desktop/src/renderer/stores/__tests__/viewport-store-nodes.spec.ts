import { describe, it, expect, beforeEach } from 'vitest';
import { useViewportStore, initialViewportState } from '../viewport-store';

// merge (not replace:true) so the action functions survive the reset
const reset = () => useViewportStore.setState(initialViewportState());
const dev = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    name: id,
    category: 'SWITCH',
    propertyId: 'b',
    networkId: 'n',
    x: null,
    y: null,
    z: null,
    floor: 1,
    ...over,
  }) as any;

describe('viewportStore - nodes + tagged selection (Spec 4)', () => {
  beforeEach(reset);

  it('tagged selection: element vs device are mutually exclusive', () => {
    useViewportStore.getState().selectElement(7);
    expect(useViewportStore.getState().selection).toEqual({ kind: 'element', expressID: 7 });
    useViewportStore.getState().selectNode('d1');
    expect(useViewportStore.getState().selection).toEqual({ kind: 'device', deviceId: 'd1' });
    useViewportStore.getState().clearSelection();
    expect(useViewportStore.getState().selection).toBeNull();
  });

  it('setDevices / upsertDevice (update + insert) / removeDevice', () => {
    useViewportStore.getState().setDevices([dev('a'), dev('b')]);
    expect(useViewportStore.getState().devices.map((d: any) => d.id)).toEqual(['a', 'b']);
    useViewportStore.getState().upsertDevice(dev('a', { x: 1, y: 2, z: 3 }));
    expect(useViewportStore.getState().devices.find((d: any) => d.id === 'a')!.x).toBe(1);
    useViewportStore.getState().upsertDevice(dev('c'));
    expect(useViewportStore.getState().devices.map((d: any) => d.id)).toEqual(['a', 'b', 'c']);
    useViewportStore.getState().removeDevice('b');
    expect(useViewportStore.getState().devices.map((d: any) => d.id)).toEqual(['a', 'c']);
  });

  it('removing the selected device clears the selection', () => {
    useViewportStore.getState().setDevices([dev('a')]);
    useViewportStore.getState().selectNode('a');
    useViewportStore.getState().removeDevice('a');
    expect(useViewportStore.getState().selection).toBeNull();
  });

  it('beginPlace / cancelPlace', () => {
    useViewportStore.getState().beginPlace('a');
    expect(useViewportStore.getState().placingDeviceId).toBe('a');
    useViewportStore.getState().cancelPlace();
    expect(useViewportStore.getState().placingDeviceId).toBeNull();
  });

  it('setNodeStatus / setNodeFilter / setAccess', () => {
    useViewportStore.getState().setDevices([dev('a')]);
    useViewportStore.getState().setNodeStatus('a', 'down');
    expect(useViewportStore.getState().nodeStatus.get('a')).toBe('down');
    useViewportStore.getState().setNodeFilter({ text: 'sw', placement: 'placed' });
    expect(useViewportStore.getState().nodeFilter.text).toBe('sw');
    expect(useViewportStore.getState().nodeFilter.placement).toBe('placed');
    useViewportStore.getState().setAccess({ role: 'ADMIN', assignedRootPropertyIds: [], unscoped: false });
    expect(useViewportStore.getState().access?.role).toBe('ADMIN');
  });

  // nodeStatus is fed by status events that fan out for every device in the socket's scope, once per
  // probe cycle. It has to stay pinned to the loaded devices or it grows for the life of the session.
  describe('nodeStatus stays pinned to the loaded devices', () => {
    const statusOf = (id: string) => useViewportStore.getState().nodeStatus.get(id);

    it('ignores a status for a device that is not loaded', () => {
      useViewportStore.getState().setDevices([dev('a')]);
      useViewportStore.getState().setNodeStatus('elsewhere', 'down');
      expect(useViewportStore.getState().nodeStatus.has('elsewhere')).toBe(false);
    });

    it('an unchanged status does not clone the map (no re-render per event)', () => {
      useViewportStore.getState().setDevices([dev('a')]);
      useViewportStore.getState().setNodeStatus('a', 'up');
      const first = useViewportStore.getState().nodeStatus;

      useViewportStore.getState().setNodeStatus('a', 'up'); // same value, as on every quiet cycle
      expect(useViewportStore.getState().nodeStatus).toBe(first); // same reference

      useViewportStore.getState().setNodeStatus('a', 'down'); // a real change still lands
      expect(useViewportStore.getState().nodeStatus).not.toBe(first);
      expect(statusOf('a')).toBe('down');
    });

    it('reloading devices drops statuses for devices that are gone, keeps the rest', () => {
      useViewportStore.getState().setDevices([dev('a'), dev('b')]);
      useViewportStore.getState().setNodeStatus('a', 'down');
      useViewportStore.getState().setNodeStatus('b', 'up');

      useViewportStore.getState().setDevices([dev('a')]); // b is no longer in the building
      expect(statusOf('a')).toBe('down');
      expect(useViewportStore.getState().nodeStatus.has('b')).toBe(false);
    });

    it('a reload that drops nothing keeps the same map reference', () => {
      useViewportStore.getState().setDevices([dev('a')]);
      useViewportStore.getState().setNodeStatus('a', 'down');
      const before = useViewportStore.getState().nodeStatus;

      useViewportStore.getState().setDevices([dev('a', { x: 1 })]); // same ids, refreshed rows
      expect(useViewportStore.getState().nodeStatus).toBe(before);
    });

    it('removeDevice drops the status entry too (deleted devices left dead entries behind)', () => {
      useViewportStore.getState().setDevices([dev('a'), dev('b')]);
      useViewportStore.getState().setNodeStatus('a', 'down');
      useViewportStore.getState().setNodeStatus('b', 'up');

      useViewportStore.getState().removeDevice('a');
      expect(useViewportStore.getState().nodeStatus.has('a')).toBe(false);
      expect(statusOf('b')).toBe('up');
    });

    it('switching building clears the status overlay with the devices it overlays', () => {
      useViewportStore.getState().setDevices([dev('a')]);
      useViewportStore.getState().setNodeStatus('a', 'down');

      useViewportStore.getState().setActiveBuilding('bld-2');
      expect(useViewportStore.getState().nodeStatus.size).toBe(0);
    });
  });

  it('switching building resets node state but keeps org-level access', () => {
    useViewportStore.getState().setDevices([dev('a')]);
    useViewportStore.getState().beginPlace('a');
    useViewportStore.getState().selectNode('a');
    useViewportStore.getState().setAccess({ role: 'OWNER', assignedRootPropertyIds: [], unscoped: true });
    useViewportStore.getState().setActiveBuilding('bld-9');
    const s = useViewportStore.getState();
    expect(s.devices).toEqual([]);
    expect(s.selection).toBeNull();
    expect(s.placingDeviceId).toBeNull();
    expect(s.access?.role).toBe('OWNER');
  });
});
