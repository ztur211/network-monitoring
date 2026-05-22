/**
 * Unit tests for network.store — the Zustand slice that holds the user's
 * single MVP network and the `onHome` flag pushed by the server.
 *
 * Mocks `axios` end-of-pipeline so the store exercises its real call chain
 * (`api.get('/networks')`) without a network round trip.
 */
import { NetworkSummary } from '@nodescope/shared';

const jestEsm = jest as typeof jest & {
  unstable_mockModule: (moduleName: string, factory: () => unknown) => void;
};

const mockGet = jest.fn();

jestEsm.unstable_mockModule('axios', () => ({
  default: {
    create: jest.fn(() => ({
      get: mockGet,
      interceptors: { response: { use: jest.fn() } },
    })),
    isAxiosError: jest.fn(() => false),
  },
}));

const { useNetworkStore } = await import('../network.store');

function freshSummary(overrides: Partial<NetworkSummary> = {}): NetworkSummary {
  return {
    id: 'net-1',
    name: 'Home',
    homeAddress: '123 Maple St',
    homeLatitude: 43.5,
    homeLongitude: -79.9,
    isp: 'Acme',
    downMbps: 1000,
    upMbps: 50,
    version: 1,
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

function resetStore(): void {
  useNetworkStore.setState({
    network: null,
    onHome: false,
    isLoading: false,
    loaded: false,
    error: null,
  });
}

describe('network.store', () => {
  beforeEach(() => {
    mockGet.mockReset();
    resetStore();
  });

  describe('load()', () => {
    it('populates `network` from the first item of GET /networks', async () => {
      const summary = freshSummary();
      mockGet.mockResolvedValueOnce({
        data: { success: true, data: [summary] },
      });

      await useNetworkStore.getState().load();
      const state = useNetworkStore.getState();

      expect(mockGet).toHaveBeenCalledWith('/networks');
      expect(state.network).toEqual(summary);
      expect(state.loaded).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets network to null when the list is empty', async () => {
      mockGet.mockResolvedValueOnce({
        data: { success: true, data: [] },
      });

      await useNetworkStore.getState().load();
      const state = useNetworkStore.getState();

      expect(state.network).toBeNull();
      expect(state.loaded).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('flips isLoading true during the call and false after', async () => {
      let snapshotMidFlight: boolean | undefined;
      mockGet.mockImplementationOnce(() => {
        snapshotMidFlight = useNetworkStore.getState().isLoading;
        return Promise.resolve({ data: { success: true, data: [] } });
      });

      await useNetworkStore.getState().load();

      expect(snapshotMidFlight).toBe(true);
      expect(useNetworkStore.getState().isLoading).toBe(false);
    });

    it('is a no-op while a previous load is in flight', async () => {
      mockGet.mockReturnValueOnce(
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: { success: true, data: [] } }), 5);
        }),
      );

      const first = useNetworkStore.getState().load();
      await useNetworkStore.getState().load(); // should short-circuit
      await first;

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('records error and leaves network null on failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('boom'));

      await useNetworkStore.getState().load();
      const state = useNetworkStore.getState();

      expect(state.network).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Failed to load network');
      // `loaded` stays false so callers can distinguish "never loaded" from
      // "loaded and empty" — the onboarding wizard relies on this.
      expect(state.loaded).toBe(false);
    });
  });

  describe('setOnHome', () => {
    it('updates the onHome flag in isolation', () => {
      useNetworkStore.getState().setOnHome(true);
      expect(useNetworkStore.getState().onHome).toBe(true);

      useNetworkStore.getState().setOnHome(false);
      expect(useNetworkStore.getState().onHome).toBe(false);
    });
  });

  describe('setNetwork', () => {
    it('replaces the cached network without touching other fields', () => {
      useNetworkStore.setState({ onHome: true, loaded: true });
      const summary = freshSummary({ id: 'net-2', name: 'Cottage' });

      useNetworkStore.getState().setNetwork(summary);

      const state = useNetworkStore.getState();
      expect(state.network).toEqual(summary);
      expect(state.onHome).toBe(true);
      expect(state.loaded).toBe(true);
    });

    it('accepts null to clear the cached network', () => {
      useNetworkStore.setState({ network: freshSummary() });

      useNetworkStore.getState().setNetwork(null);

      expect(useNetworkStore.getState().network).toBeNull();
    });
  });
});
