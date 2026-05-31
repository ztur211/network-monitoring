/**
 * Unit tests for device.store — the Zustand slice that owns the
 * optimistic CRUD lifecycle for devices. Tracks: devices[], isLoading,
 * loaded, loadedAt, error, offlineQueue[].
 *
 * Mocks `axios` end-of-pipeline so the store exercises its real
 * api.get/post/patch/delete call chain without a network round trip.
 * The store has no websocket dependency so no spyOn needed.
 */
import { DeviceDto } from '@nodescope/shared';

const jestEsm = jest as typeof jest & {
  unstable_mockModule: (moduleName: string, factory: () => unknown) => void;
};

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jestEsm.unstable_mockModule('axios', () => ({
  default: {
    create: jest.fn(() => ({
      get: mockGet,
      post: mockPost,
      patch: mockPatch,
      delete: mockDelete,
      interceptors: { response: { use: jest.fn() } },
    })),
    isAxiosError: jest.fn(() => false),
  },
}));

const { useDeviceStore } = await import('../device.store');

function freshDevice(overrides: Partial<DeviceDto> = {}): DeviceDto {
  return {
    id: 'dev-1',
    userId: 'user-1',
    name: 'Living Room Router',
    category: 'ROUTER',
    latitude: 43.5,
    longitude: -79.9,
    floor: null,
    floorLabel: null,
    ipAddress: '192.168.1.1',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    notes: null,
    browserDeviceId: null,
    version: 1,
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

function resetStore(): void {
  useDeviceStore.setState({
    devices: [],
    isLoading: false,
    loaded: false,
    loadedAt: null,
    error: null,
    offlineQueue: [],
    offlineSyncError: null,
    flushing: false,
  });
}

describe('device.store', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
    resetStore();
  });

  describe('loadDevices()', () => {
    it('populates `devices` from GET /devices items[]', async () => {
      const d1 = freshDevice({ id: 'd1' });
      const d2 = freshDevice({ id: 'd2', name: 'AP' });
      mockGet.mockResolvedValueOnce({
        data: { success: true, data: { items: [d1, d2], total: 2 } },
      });

      await useDeviceStore.getState().loadDevices();
      const state = useDeviceStore.getState();

      expect(mockGet).toHaveBeenCalledWith('/devices');
      expect(state.devices).toEqual([d1, d2]);
      expect(state.loaded).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.loadedAt).toBeTruthy();
      expect(state.error).toBeNull();
    });

    it('is a no-op while a previous load is in flight', async () => {
      mockGet.mockReturnValueOnce(
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({ data: { success: true, data: { items: [], total: 0 } } }),
            5,
          );
        }),
      );

      const first = useDeviceStore.getState().loadDevices();
      await useDeviceStore.getState().loadDevices(); // should short-circuit
      await first;

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('records error and leaves devices unchanged on failure', async () => {
      useDeviceStore.setState({ devices: [freshDevice()] });
      mockGet.mockRejectedValueOnce(new Error('boom'));

      await useDeviceStore.getState().loadDevices();
      const state = useDeviceStore.getState();

      expect(state.devices).toHaveLength(1);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Failed to load devices');
      expect(state.loaded).toBe(false);
    });
  });

  describe('upsertDevice / removeDevice', () => {
    it('upsertDevice appends a new device when id is unknown', () => {
      useDeviceStore.getState().upsertDevice(freshDevice({ id: 'new-1' }));
      expect(useDeviceStore.getState().devices).toHaveLength(1);
      expect(useDeviceStore.getState().devices[0].id).toBe('new-1');
    });

    it('upsertDevice replaces in-place when id is known', () => {
      useDeviceStore.setState({ devices: [freshDevice({ id: 'd1', name: 'old' })] });
      useDeviceStore.getState().upsertDevice(freshDevice({ id: 'd1', name: 'new' }));

      const { devices } = useDeviceStore.getState();
      expect(devices).toHaveLength(1);
      expect(devices[0].name).toBe('new');
    });

    it('removeDevice strips the matching id', () => {
      useDeviceStore.setState({
        devices: [freshDevice({ id: 'a' }), freshDevice({ id: 'b' })],
      });
      useDeviceStore.getState().removeDevice('a');

      expect(useDeviceStore.getState().devices.map((d) => d.id)).toEqual(['b']);
    });
  });

  describe('createDevice()', () => {
    it('adds optimistic placeholder and swaps in the server-returned row on success', async () => {
      const created = freshDevice({ id: 'dev-created', name: 'Modem' });
      let optimisticSeen: DeviceDto[] = [];
      mockPost.mockImplementationOnce(() => {
        optimisticSeen = [...useDeviceStore.getState().devices];
        return Promise.resolve({ data: { success: true, data: created } });
      });

      const result = await useDeviceStore.getState().createDevice({
        name: 'Modem',
        category: 'MODEM',
      });

      // Optimistic snapshot taken mid-flight had the temp row in place
      expect(optimisticSeen).toHaveLength(1);
      expect(optimisticSeen[0].id).toMatch(/^temp-/);
      expect(optimisticSeen[0].name).toBe('Modem');

      // After success, temp was swapped for the server row
      const finalDevices = useDeviceStore.getState().devices;
      expect(finalDevices).toHaveLength(1);
      expect(finalDevices[0]).toEqual(created);
      expect(result).toEqual(created);
    });

    it('rolls back the optimistic add and queues an offline op on failure', async () => {
      mockPost.mockRejectedValueOnce(new Error('offline'));

      await expect(
        useDeviceStore.getState().createDevice({ name: 'Modem', category: 'MODEM' }),
      ).rejects.toThrow('Failed to create device');

      const state = useDeviceStore.getState();
      expect(state.devices).toEqual([]);
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0]).toMatchObject({
        type: 'create',
        input: { name: 'Modem', category: 'MODEM' },
      });
    });

    it('sends an Idempotency-Key header so an offline create-replay cannot duplicate the row', async () => {
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: freshDevice({ id: 'd-new' }) },
      });

      await useDeviceStore.getState().createDevice({ name: 'Modem', category: 'MODEM' });

      expect(mockPost).toHaveBeenCalledWith(
        '/devices',
        { name: 'Modem', category: 'MODEM' },
        { headers: { 'Idempotency-Key': expect.any(String) } },
      );
    });
  });

  describe('updateDevice()', () => {
    it('no-ops and returns the original device when input has no changes', async () => {
      const original = freshDevice();
      useDeviceStore.setState({ devices: [original] });

      const result = await useDeviceStore.getState().updateDevice(
        original.id,
        original,
        { name: original.name },
      );

      expect(result).toBe(original);
      expect(mockPatch).not.toHaveBeenCalled();
    });

    it('PATCHes with a diffed changeset and folds the server response back in', async () => {
      const original = freshDevice({ id: 'd1', name: 'Old', version: 1 });
      const updated = freshDevice({
        id: 'd1',
        name: 'New',
        version: 2,
        updatedAt: '2026-05-28T00:00:00.000Z',
      });
      useDeviceStore.setState({ devices: [original] });
      mockPatch.mockResolvedValueOnce({ data: { success: true, data: updated } });

      const result = await useDeviceStore.getState().updateDevice(original.id, original, {
        name: 'New',
      });

      expect(mockPatch).toHaveBeenCalledWith('/devices/d1', {
        baseVersion: 1,
        changes: [{ field: 'name', oldValue: 'Old', newValue: 'New' }],
      });
      expect(result).toEqual(updated);
      expect(useDeviceStore.getState().devices[0]).toEqual(updated);
    });

    it('rolls back to the previous device and queues an offline op on failure', async () => {
      const original = freshDevice({ id: 'd1', name: 'Old', version: 1 });
      useDeviceStore.setState({ devices: [original] });
      mockPatch.mockRejectedValueOnce(new Error('offline'));

      await expect(
        useDeviceStore.getState().updateDevice(original.id, original, { name: 'New' }),
      ).rejects.toThrow('Failed to update device');

      const state = useDeviceStore.getState();
      expect(state.devices[0]).toEqual(original);
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0]).toMatchObject({
        type: 'update',
        deviceId: 'd1',
        input: { name: 'New' },
        previousDevice: original,
      });
    });
  });

  describe('deleteDevice()', () => {
    it('optimistically removes and DELETEs the row', async () => {
      const target = freshDevice({ id: 'gone' });
      useDeviceStore.setState({ devices: [target, freshDevice({ id: 'keep' })] });
      mockDelete.mockResolvedValueOnce({ data: { success: true } });

      await useDeviceStore.getState().deleteDevice('gone');

      expect(mockDelete).toHaveBeenCalledWith('/devices/gone');
      expect(useDeviceStore.getState().devices.map((d) => d.id)).toEqual(['keep']);
    });

    it('restores the device and queues an offline op on failure', async () => {
      const target = freshDevice({ id: 'gone' });
      useDeviceStore.setState({ devices: [target] });
      mockDelete.mockRejectedValueOnce(new Error('offline'));

      await expect(useDeviceStore.getState().deleteDevice('gone')).rejects.toThrow(
        'Failed to delete device',
      );

      const state = useDeviceStore.getState();
      expect(state.devices).toHaveLength(1);
      expect(state.devices[0]).toEqual(target);
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0]).toMatchObject({ type: 'delete', deviceId: 'gone' });
    });

    it('is a no-op when the deviceId does not match any device', async () => {
      useDeviceStore.setState({ devices: [] });
      await useDeviceStore.getState().deleteDevice('ghost');

      expect(mockDelete).not.toHaveBeenCalled();
      expect(useDeviceStore.getState().offlineQueue).toHaveLength(0);
    });
  });

  describe('flushOfflineQueue()', () => {
    it('drains the queue by replaying each op through the normal CRUD methods', async () => {
      const previous = freshDevice({ id: 'd1', version: 1 });
      useDeviceStore.setState({
        devices: [previous],
        offlineQueue: [
          { type: 'create', input: { name: 'X', category: 'ROUTER' }, tempId: 'temp-old', idempotencyKey: 'idem-old', attempts: 0 },
          {
            type: 'update',
            deviceId: 'd1',
            input: { name: 'Renamed' },
            previousDevice: previous,
            attempts: 0,
          },
        ],
      });
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: freshDevice({ id: 'd-created' }) },
      });
      mockPatch.mockResolvedValueOnce({
        data: { success: true, data: freshDevice({ id: 'd1', name: 'Renamed', version: 2 }) },
      });

      await useDeviceStore.getState().flushOfflineQueue();

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPatch).toHaveBeenCalledTimes(1);
      expect(useDeviceStore.getState().offlineQueue).toEqual([]);
    });

    it('replays a queued create with the SAME idempotency key', async () => {
      useDeviceStore.setState({
        offlineQueue: [
          { type: 'create', input: { name: 'X', category: 'ROUTER' }, tempId: 't', idempotencyKey: 'idem-fixed', attempts: 0 },
        ],
      });
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: freshDevice({ id: 'd-x' }) },
      });

      await useDeviceStore.getState().flushOfflineQueue();

      expect(mockPost).toHaveBeenCalledWith(
        '/devices',
        { name: 'X', category: 'ROUTER' },
        { headers: { 'Idempotency-Key': 'idem-fixed' } },
      );
    });

    it('is a no-op when the queue is empty', async () => {
      await useDeviceStore.getState().flushOfflineQueue();
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockPatch).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('continues processing remaining ops even if one fails (failed ops re-queue themselves)', async () => {
      const previous = freshDevice({ id: 'd1', version: 1 });
      useDeviceStore.setState({
        devices: [previous],
        offlineQueue: [
          // First op fails — re-queues itself via createDevice's catch
          { type: 'create', input: { name: 'X', category: 'ROUTER' }, tempId: 'temp-1', idempotencyKey: 'idem-1', attempts: 0 },
          // Second op succeeds
          {
            type: 'update',
            deviceId: 'd1',
            input: { name: 'Renamed' },
            previousDevice: previous,
            attempts: 0,
          },
        ],
      });
      mockPost.mockRejectedValueOnce(new Error('still offline'));
      mockPatch.mockResolvedValueOnce({
        data: { success: true, data: freshDevice({ id: 'd1', name: 'Renamed', version: 2 }) },
      });

      await useDeviceStore.getState().flushOfflineQueue();

      // The failed create re-queued itself; the update succeeded.
      const state = useDeviceStore.getState();
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0].type).toBe('create');
    });

    it('requeues a transiently-failing op with an incremented attempt count', async () => {
      const previous = freshDevice({ id: 'd1', version: 1 });
      useDeviceStore.setState({
        devices: [previous],
        offlineQueue: [
          { type: 'update', deviceId: 'd1', input: { name: 'New' }, previousDevice: previous, attempts: 1 },
        ],
      });
      mockPatch.mockRejectedValueOnce(new Error('still offline'));

      await useDeviceStore.getState().flushOfflineQueue();

      const state = useDeviceStore.getState();
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0].attempts).toBe(2);
      expect(state.offlineSyncError).toBeNull();
    });

    it('drops an op and surfaces a sync error on a 409 conflict (no infinite loop on SYNC_001)', async () => {
      const previous = freshDevice({ id: 'd1', version: 1 });
      useDeviceStore.setState({
        devices: [previous],
        offlineQueue: [
          { type: 'update', deviceId: 'd1', input: { name: 'New' }, previousDevice: previous, attempts: 0 },
        ],
      });
      mockPatch.mockRejectedValueOnce({ response: { status: 409 } });

      await useDeviceStore.getState().flushOfflineQueue();

      const state = useDeviceStore.getState();
      expect(state.offlineQueue).toEqual([]);
      expect(state.offlineSyncError).toMatch(/changed somewhere else/i);
    });

    it('drops an op and surfaces a sync error after exhausting the retry budget', async () => {
      const previous = freshDevice({ id: 'd1', version: 1 });
      useDeviceStore.setState({
        devices: [previous],
        offlineQueue: [
          { type: 'update', deviceId: 'd1', input: { name: 'New' }, previousDevice: previous, attempts: 4 },
        ],
      });
      mockPatch.mockRejectedValueOnce(new Error('still offline'));

      await useDeviceStore.getState().flushOfflineQueue();

      const state = useDeviceStore.getState();
      expect(state.offlineQueue).toEqual([]);
      expect(state.offlineSyncError).toMatch(/after several attempts/i);
    });

    it('is a no-op while a flush is already in flight', async () => {
      useDeviceStore.setState({
        flushing: true,
        offlineQueue: [
          { type: 'create', input: { name: 'X', category: 'ROUTER' }, tempId: 't', idempotencyKey: 'idem-t', attempts: 0 },
        ],
      });

      await useDeviceStore.getState().flushOfflineQueue();

      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});
