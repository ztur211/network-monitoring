import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitLink, clearLink } from '../link';
import { useViewportStore, initialViewportState } from '../../../stores/viewport-store';

const dev = (id: string, over = {}) =>
  ({ id, name: id, category: 'SWITCH', propertyId: 'b', networkId: 'n', ifcGlobalId: null, ...over }) as any;

beforeEach(() => {
  useViewportStore.setState(initialViewportState());
  useViewportStore.getState().setDevices([dev('a')]);
  useViewportStore.getState().beginLink('a');
});

describe('commitLink', () => {
  it('optimistically sets ifcGlobalId, persists, upserts the result, and exits linking mode', async () => {
    const rest = { setDeviceIfcLink: vi.fn().mockResolvedValue(dev('a', { ifcGlobalId: 'GUID1' })) };
    await commitLink('a', 'GUID1', { rest: rest as any });
    expect(useViewportStore.getState().devices[0].ifcGlobalId).toBe('GUID1');
    expect(useViewportStore.getState().linkingDeviceId).toBeNull();
    expect(rest.setDeviceIfcLink).toHaveBeenCalledWith('a', 'GUID1');
  });

  it('rolls back to the prior link on rejection and notifies', async () => {
    const rest = {
      setDeviceIfcLink: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { code: 'PERM_001' })),
    };
    const notify = vi.fn();
    await commitLink('a', 'GUID1', { rest: rest as any, notify });
    expect(useViewportStore.getState().devices[0].ifcGlobalId).toBeNull(); // rolled back
    expect(notify).toHaveBeenCalled();
  });
});

describe('clearLink', () => {
  it('clears ifcGlobalId optimistically and persists null', async () => {
    useViewportStore.getState().upsertDevice(dev('a', { ifcGlobalId: 'GUID1' }));
    const rest = { setDeviceIfcLink: vi.fn().mockResolvedValue(dev('a', { ifcGlobalId: null })) };
    await clearLink('a', { rest: rest as any });
    expect(useViewportStore.getState().devices[0].ifcGlobalId).toBeNull();
    expect(rest.setDeviceIfcLink).toHaveBeenCalledWith('a', null);
  });

  it('rolls back to the prior guid on rejection', async () => {
    useViewportStore.getState().upsertDevice(dev('a', { ifcGlobalId: 'GUID1' }));
    const rest = { setDeviceIfcLink: vi.fn().mockRejectedValue(new Error('no')) };
    await clearLink('a', { rest: rest as any });
    expect(useViewportStore.getState().devices[0].ifcGlobalId).toBe('GUID1');
  });
});
