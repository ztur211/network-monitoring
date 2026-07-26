/**
 * Unit tests for network.store — the Zustand slice that holds the user's
 * single MVP network and the `onHome` flag pushed by the server.
 *
 * Mocks `axios` end-of-pipeline so the store exercises its real call chain
 * (`api.get('/networks')`) without a network round trip.
 */
import { NetworkSummary } from '@nodescope/shared';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.doMock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: mockGet,
      post: mockPost,
      interceptors: { response: { use: vi.fn() } },
    })),
    isAxiosError: vi.fn(() => false),
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
    savingHomeIp: false,
    setHomeIpError: null,
  });
}

describe('network.store', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
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

  describe('setHomeIp()', () => {
    it('POSTs /networks/:id/set-home-ip and updates `network` with the returned summary (stripping homePublicIp)', async () => {
      useNetworkStore.setState({ network: freshSummary({ id: 'net-7' }) });
      mockPost.mockResolvedValueOnce({
        data: {
          success: true,
          data: { ...freshSummary({ id: 'net-7', version: 2 }), homePublicIp: '203.0.113.42' },
        },
      });

      await useNetworkStore.getState().setHomeIp();
      const state = useNetworkStore.getState();

      expect(mockPost).toHaveBeenCalledWith('/networks/net-7/set-home-ip');
      expect(state.network).toEqual(freshSummary({ id: 'net-7', version: 2 }));
      expect(state.network as unknown as { homePublicIp?: string }).not.toHaveProperty(
        'homePublicIp',
      );
      expect(state.savingHomeIp).toBe(false);
      expect(state.setHomeIpError).toBeNull();
    });

    it('is a no-op when there is no cached network (pre-onboarding)', async () => {
      useNetworkStore.setState({ network: null });

      await useNetworkStore.getState().setHomeIp();

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('flips savingHomeIp true mid-flight and false after success', async () => {
      useNetworkStore.setState({ network: freshSummary() });
      let midFlight: boolean | undefined;
      mockPost.mockImplementationOnce(() => {
        midFlight = useNetworkStore.getState().savingHomeIp;
        return Promise.resolve({
          data: { success: true, data: { ...freshSummary({ version: 2 }), homePublicIp: '1.2.3.4' } },
        });
      });

      await useNetworkStore.getState().setHomeIp();

      expect(midFlight).toBe(true);
      expect(useNetworkStore.getState().savingHomeIp).toBe(false);
    });

    it('is a no-op while a previous setHomeIp is in flight', async () => {
      useNetworkStore.setState({ network: freshSummary() });
      mockPost.mockReturnValueOnce(
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                data: {
                  success: true,
                  data: { ...freshSummary({ version: 2 }), homePublicIp: '1.2.3.4' },
                },
              }),
            5,
          );
        }),
      );

      const first = useNetworkStore.getState().setHomeIp();
      await useNetworkStore.getState().setHomeIp(); // should short-circuit
      await first;

      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('records setHomeIpError on failure and leaves network unchanged', async () => {
      const original = freshSummary({ id: 'net-7' });
      useNetworkStore.setState({ network: original });
      mockPost.mockRejectedValueOnce(new Error('boom'));

      await useNetworkStore.getState().setHomeIp();
      const state = useNetworkStore.getState();

      expect(state.network).toEqual(original);
      expect(state.savingHomeIp).toBe(false);
      expect(state.setHomeIpError).toBe('Failed to save home IP');
    });
  });
});
