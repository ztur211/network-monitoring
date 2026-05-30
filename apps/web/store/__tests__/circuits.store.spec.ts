/**
 * Unit tests for circuits.store — same optimistic-CRUD shape as
 * device.store plus cursor pagination via loadNextPage().
 *
 * Tracks: circuits[], isLoading, loaded, loadedAt, error, nextCursor,
 * total, offlineQueue[].
 *
 * Mocks `axios` end-of-pipeline. No websocket dependency.
 */
import { CircuitDto } from '@nodescope/shared';

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

const { useCircuitStore } = await import('../circuits.store');

function freshCircuit(overrides: Partial<CircuitDto> = {}): CircuitDto {
  return {
    id: 'circ-1',
    userId: 'user-1',
    ispName: 'Acme Telecom',
    circuitId: 'XY-123',
    serviceType: 'FIBER',
    bandwidth: 1000,
    deviceId: null,
    notes: null,
    version: 1,
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

function resetStore(): void {
  useCircuitStore.setState({
    circuits: [],
    isLoading: false,
    loaded: false,
    loadedAt: null,
    error: null,
    nextCursor: null,
    total: 0,
    offlineQueue: [],
    offlineSyncError: null,
    flushing: false,
  });
}

describe('circuits.store', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
    resetStore();
  });

  describe('loadCircuits()', () => {
    it('GETs /circuits?limit=50 and folds the response into the store', async () => {
      const c1 = freshCircuit({ id: 'c1' });
      const c2 = freshCircuit({ id: 'c2', ispName: 'Other' });
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          data: { items: [c1, c2], nextCursor: 'cursor-xyz', total: 2 },
        },
      });

      await useCircuitStore.getState().loadCircuits();
      const state = useCircuitStore.getState();

      expect(mockGet).toHaveBeenCalledWith('/circuits?limit=50');
      expect(state.circuits).toEqual([c1, c2]);
      expect(state.nextCursor).toBe('cursor-xyz');
      expect(state.total).toBe(2);
      expect(state.loaded).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('records error and leaves circuits unchanged on failure', async () => {
      useCircuitStore.setState({ circuits: [freshCircuit()] });
      mockGet.mockRejectedValueOnce(new Error('boom'));

      await useCircuitStore.getState().loadCircuits();
      const state = useCircuitStore.getState();

      expect(state.circuits).toHaveLength(1);
      expect(state.error).toBe('Failed to load circuits');
      expect(state.loaded).toBe(false);
    });

    it('is a no-op while a previous load is in flight', async () => {
      mockGet.mockReturnValueOnce(
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                data: {
                  success: true,
                  data: { items: [], nextCursor: null, total: 0 },
                },
              }),
            5,
          );
        }),
      );

      const first = useCircuitStore.getState().loadCircuits();
      await useCircuitStore.getState().loadCircuits();
      await first;

      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadNextPage()', () => {
    it('GETs /circuits with the cursor and appends to the existing list', async () => {
      const first = freshCircuit({ id: 'c1' });
      useCircuitStore.setState({
        circuits: [first],
        nextCursor: 'cursor-2',
        total: 2,
      });
      const second = freshCircuit({ id: 'c2' });
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          data: { items: [second], nextCursor: null, total: 2 },
        },
      });

      await useCircuitStore.getState().loadNextPage();
      const state = useCircuitStore.getState();

      expect(mockGet).toHaveBeenCalledWith('/circuits?limit=50&cursor=cursor-2');
      expect(state.circuits.map((c) => c.id)).toEqual(['c1', 'c2']);
      expect(state.nextCursor).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('url-encodes the cursor', async () => {
      useCircuitStore.setState({ nextCursor: 'abc/def+ghi' });
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          data: { items: [], nextCursor: null, total: 0 },
        },
      });

      await useCircuitStore.getState().loadNextPage();

      expect(mockGet).toHaveBeenCalledWith('/circuits?limit=50&cursor=abc%2Fdef%2Bghi');
    });

    it('is a no-op when there is no nextCursor', async () => {
      useCircuitStore.setState({ nextCursor: null });

      await useCircuitStore.getState().loadNextPage();

      expect(mockGet).not.toHaveBeenCalled();
    });

    it('is a no-op while a load is already in flight', async () => {
      useCircuitStore.setState({ nextCursor: 'cursor-1', isLoading: true });

      await useCircuitStore.getState().loadNextPage();

      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('upsertCircuit / removeCircuit', () => {
    it('upsertCircuit appends when id is unknown, replaces in-place when known', () => {
      useCircuitStore.getState().upsertCircuit(freshCircuit({ id: 'c1', ispName: 'A' }));
      useCircuitStore.getState().upsertCircuit(freshCircuit({ id: 'c1', ispName: 'A-updated' }));
      useCircuitStore.getState().upsertCircuit(freshCircuit({ id: 'c2', ispName: 'B' }));

      const { circuits } = useCircuitStore.getState();
      expect(circuits).toHaveLength(2);
      expect(circuits.find((c) => c.id === 'c1')?.ispName).toBe('A-updated');
      expect(circuits.find((c) => c.id === 'c2')?.ispName).toBe('B');
    });

    it('removeCircuit strips the matching id', () => {
      useCircuitStore.setState({
        circuits: [freshCircuit({ id: 'a' }), freshCircuit({ id: 'b' })],
      });
      useCircuitStore.getState().removeCircuit('a');

      expect(useCircuitStore.getState().circuits.map((c) => c.id)).toEqual(['b']);
    });
  });

  describe('createCircuit()', () => {
    it('prepends an optimistic placeholder and swaps it for the server row on success', async () => {
      const created = freshCircuit({ id: 'srv-1', ispName: 'New' });
      let optimisticSeen: CircuitDto[] = [];
      mockPost.mockImplementationOnce(() => {
        optimisticSeen = [...useCircuitStore.getState().circuits];
        return Promise.resolve({ data: { success: true, data: created } });
      });

      const result = await useCircuitStore.getState().createCircuit({
        ispName: 'New',
        serviceType: 'FIBER',
      });

      expect(optimisticSeen).toHaveLength(1);
      expect(optimisticSeen[0].id).toMatch(/^temp-/);
      expect(optimisticSeen[0].ispName).toBe('New');

      const state = useCircuitStore.getState();
      expect(state.circuits).toEqual([created]);
      expect(state.total).toBe(1);
      expect(result).toEqual(created);
    });

    it('rolls back the optimistic add and queues an offline op on failure', async () => {
      mockPost.mockRejectedValueOnce(new Error('offline'));

      await expect(
        useCircuitStore.getState().createCircuit({ ispName: 'A', serviceType: 'FIBER' }),
      ).rejects.toThrow('Failed to create circuit');

      const state = useCircuitStore.getState();
      expect(state.circuits).toEqual([]);
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0]).toMatchObject({
        type: 'create',
        input: { ispName: 'A', serviceType: 'FIBER' },
      });
    });
  });

  describe('updateCircuit()', () => {
    it('returns the original and skips the PATCH when input has no changes', async () => {
      const original = freshCircuit();
      const result = await useCircuitStore
        .getState()
        .updateCircuit(original.id, original, { ispName: original.ispName });

      expect(result).toBe(original);
      expect(mockPatch).not.toHaveBeenCalled();
    });

    it('PATCHes with a diffed changeset and folds the server response back in', async () => {
      const original = freshCircuit({ id: 'c1', ispName: 'Old', version: 1 });
      const updated = freshCircuit({ id: 'c1', ispName: 'New', version: 2 });
      useCircuitStore.setState({ circuits: [original] });
      mockPatch.mockResolvedValueOnce({ data: { success: true, data: updated } });

      const result = await useCircuitStore
        .getState()
        .updateCircuit(original.id, original, { ispName: 'New' });

      expect(mockPatch).toHaveBeenCalledWith('/circuits/c1', {
        baseVersion: 1,
        changes: [{ field: 'ispName', oldValue: 'Old', newValue: 'New' }],
      });
      expect(result).toEqual(updated);
      expect(useCircuitStore.getState().circuits[0]).toEqual(updated);
    });

    it('rolls back to the previous circuit and queues an offline op on failure', async () => {
      const original = freshCircuit({ id: 'c1', ispName: 'Old', version: 1 });
      useCircuitStore.setState({ circuits: [original] });
      mockPatch.mockRejectedValueOnce(new Error('offline'));

      await expect(
        useCircuitStore.getState().updateCircuit(original.id, original, { ispName: 'New' }),
      ).rejects.toThrow('Failed to update circuit');

      const state = useCircuitStore.getState();
      expect(state.circuits[0]).toEqual(original);
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0]).toMatchObject({
        type: 'update',
        circuitId: 'c1',
        previousCircuit: original,
      });
    });
  });

  describe('deleteCircuit()', () => {
    it('optimistically removes the row + decrements total + DELETEs', async () => {
      const target = freshCircuit({ id: 'gone' });
      useCircuitStore.setState({
        circuits: [target, freshCircuit({ id: 'keep' })],
        total: 2,
      });
      mockDelete.mockResolvedValueOnce({ data: { success: true } });

      await useCircuitStore.getState().deleteCircuit('gone');

      expect(mockDelete).toHaveBeenCalledWith('/circuits/gone');
      const state = useCircuitStore.getState();
      expect(state.circuits.map((c) => c.id)).toEqual(['keep']);
      expect(state.total).toBe(1);
    });

    it('clamps total at zero on optimistic delete', async () => {
      const target = freshCircuit({ id: 'gone' });
      useCircuitStore.setState({ circuits: [target], total: 0 });
      mockDelete.mockResolvedValueOnce({ data: { success: true } });

      await useCircuitStore.getState().deleteCircuit('gone');

      expect(useCircuitStore.getState().total).toBe(0);
    });

    it('restores the circuit and queues an offline op on failure', async () => {
      const target = freshCircuit({ id: 'gone' });
      useCircuitStore.setState({ circuits: [target], total: 1 });
      mockDelete.mockRejectedValueOnce(new Error('offline'));

      await expect(useCircuitStore.getState().deleteCircuit('gone')).rejects.toThrow(
        'Failed to delete circuit',
      );

      const state = useCircuitStore.getState();
      expect(state.circuits).toHaveLength(1);
      expect(state.total).toBe(1);
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0]).toMatchObject({ type: 'delete', circuitId: 'gone' });
    });

    it('is a no-op when the circuitId does not match', async () => {
      useCircuitStore.setState({ circuits: [] });
      await useCircuitStore.getState().deleteCircuit('ghost');

      expect(mockDelete).not.toHaveBeenCalled();
      expect(useCircuitStore.getState().offlineQueue).toHaveLength(0);
    });
  });

  describe('flushOfflineQueue()', () => {
    it('drains the queue by replaying each op through the normal CRUD methods', async () => {
      const previous = freshCircuit({ id: 'c1', version: 1 });
      useCircuitStore.setState({
        circuits: [previous],
        offlineQueue: [
          { type: 'create', input: { ispName: 'X', serviceType: 'FIBER' }, tempId: 'temp-1', attempts: 0 },
          {
            type: 'update',
            circuitId: 'c1',
            input: { ispName: 'Renamed' },
            previousCircuit: previous,
            attempts: 0,
          },
        ],
      });
      mockPost.mockResolvedValueOnce({
        data: { success: true, data: freshCircuit({ id: 'srv-x' }) },
      });
      mockPatch.mockResolvedValueOnce({
        data: { success: true, data: freshCircuit({ id: 'c1', ispName: 'Renamed', version: 2 }) },
      });

      await useCircuitStore.getState().flushOfflineQueue();

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPatch).toHaveBeenCalledTimes(1);
      expect(useCircuitStore.getState().offlineQueue).toEqual([]);
    });

    it('is a no-op when the queue is empty', async () => {
      await useCircuitStore.getState().flushOfflineQueue();
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockPatch).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('requeues a transiently-failing op with an incremented attempt count', async () => {
      const previous = freshCircuit({ id: 'c1', version: 1 });
      useCircuitStore.setState({
        circuits: [previous],
        offlineQueue: [
          { type: 'update', circuitId: 'c1', input: { ispName: 'New' }, previousCircuit: previous, attempts: 1 },
        ],
      });
      mockPatch.mockRejectedValueOnce(new Error('still offline'));

      await useCircuitStore.getState().flushOfflineQueue();

      const state = useCircuitStore.getState();
      expect(state.offlineQueue).toHaveLength(1);
      expect(state.offlineQueue[0].attempts).toBe(2);
      expect(state.offlineSyncError).toBeNull();
    });

    it('drops an op and surfaces a sync error on a 409 conflict (no infinite loop on SYNC_001)', async () => {
      const previous = freshCircuit({ id: 'c1', version: 1 });
      useCircuitStore.setState({
        circuits: [previous],
        offlineQueue: [
          { type: 'update', circuitId: 'c1', input: { ispName: 'New' }, previousCircuit: previous, attempts: 0 },
        ],
      });
      mockPatch.mockRejectedValueOnce({ response: { status: 409 } });

      await useCircuitStore.getState().flushOfflineQueue();

      const state = useCircuitStore.getState();
      expect(state.offlineQueue).toEqual([]);
      expect(state.offlineSyncError).toMatch(/changed somewhere else/i);
    });

    it('drops an op and surfaces a sync error after exhausting the retry budget', async () => {
      const previous = freshCircuit({ id: 'c1', version: 1 });
      useCircuitStore.setState({
        circuits: [previous],
        offlineQueue: [
          { type: 'update', circuitId: 'c1', input: { ispName: 'New' }, previousCircuit: previous, attempts: 4 },
        ],
      });
      mockPatch.mockRejectedValueOnce(new Error('still offline'));

      await useCircuitStore.getState().flushOfflineQueue();

      const state = useCircuitStore.getState();
      expect(state.offlineQueue).toEqual([]);
      expect(state.offlineSyncError).toMatch(/after several attempts/i);
    });

    it('is a no-op while a flush is already in flight', async () => {
      useCircuitStore.setState({
        flushing: true,
        offlineQueue: [
          { type: 'create', input: { ispName: 'X', serviceType: 'FIBER' }, tempId: 't', attempts: 0 },
        ],
      });

      await useCircuitStore.getState().flushOfflineQueue();

      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});
