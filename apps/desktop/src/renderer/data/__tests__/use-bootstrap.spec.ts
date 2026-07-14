/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { bootstrap, useBootstrap } from '../use-bootstrap';
import { buildClients, getClients } from '../clients';
import { useSitesStore } from '../../stores/sites-store';
import { useAuthStore } from '../../stores/auth-store';

// Stand in for the real module so the hook can be driven without the preload bridge, while keeping
// the shared-pointer semantics (set/get) that bootstrap's teardown relies on.
vi.mock('../clients', () => {
  let current: unknown = null;
  return {
    buildClients: vi.fn(),
    setClients: (c: unknown) => {
      current = c;
    },
    getClients: () => current,
  };
});

const buildClientsMock = vi.mocked(buildClients);

function fakeClients() {
  return {
    rest: {
      getOrganization: vi.fn().mockResolvedValue({ id: 'o', name: 'Acme' }),
      listProperties: vi.fn().mockResolvedValue([{ id: 'b' }]),
    },
    realtime: {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      disconnect: vi.fn(),
    },
  };
}

beforeEach(() => {
  useSitesStore.setState({ properties: [], selectedBuildingId: null });
  useAuthStore.setState({ authed: false, org: null });
  buildClientsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('bootstrap', () => {
  it('loads org + properties into the stores and connects realtime', async () => {
    const clients = fakeClients();

    await bootstrap(clients as never);

    expect(useAuthStore.getState().org).toEqual({ id: 'o', name: 'Acme' });
    expect(useSitesStore.getState().properties).toEqual([{ id: 'b' }]);
    expect(clients.realtime.connect).toHaveBeenCalled();
    expect(clients.realtime.on).toHaveBeenCalledTimes(4);
  });

  it('returns a teardown that unsubscribes every listener and closes the socket', async () => {
    const clients = fakeClients();

    const teardown = await bootstrap(clients as never);
    expect(getClients()).toBe(clients);

    teardown();

    expect(clients.realtime.off).toHaveBeenCalledTimes(4);
    // Same handler identity that was registered, so the registry entry actually goes away.
    for (const [evt, handler] of clients.realtime.on.mock.calls) {
      expect(clients.realtime.off).toHaveBeenCalledWith(evt, handler);
    }
    expect(clients.realtime.disconnect).toHaveBeenCalledTimes(1);
    expect(getClients()).toBeNull();
  });

  it('teardown of a superseded client does not retract a newer client pointer', async () => {
    const older = fakeClients();
    const newer = fakeClients();

    const teardownOlder = await bootstrap(older as never);
    await bootstrap(newer as never);

    teardownOlder();

    expect(older.realtime.disconnect).toHaveBeenCalledTimes(1);
    expect(getClients()).toBe(newer);
  });
});

describe('useBootstrap', () => {
  it('disconnects the realtime client when auth flips false (no orphaned socket per cycle)', async () => {
    const clients = fakeClients();
    buildClientsMock.mockResolvedValue(clients as never);

    useAuthStore.setState({ authed: true });
    renderHook(() => useBootstrap());
    await act(async () => {});

    expect(clients.realtime.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      useAuthStore.setState({ authed: false }); // logout
    });

    expect(clients.realtime.off).toHaveBeenCalledTimes(4);
    expect(clients.realtime.disconnect).toHaveBeenCalledTimes(1);
  });

  it('re-login builds a fresh client and leaves no live client behind', async () => {
    const first = fakeClients();
    const second = fakeClients();
    buildClientsMock.mockResolvedValueOnce(first as never).mockResolvedValueOnce(second as never);

    useAuthStore.setState({ authed: true });
    renderHook(() => useBootstrap());
    await act(async () => {});

    await act(async () => {
      useAuthStore.setState({ authed: false });
    });
    await act(async () => {
      useAuthStore.setState({ authed: true });
    });

    expect(first.realtime.disconnect).toHaveBeenCalledTimes(1);
    expect(second.realtime.connect).toHaveBeenCalledTimes(1);
    expect(second.realtime.disconnect).not.toHaveBeenCalled();
    expect(getClients()).toBe(second);
  });

  it('disposes a client whose async build resolves after logout', async () => {
    const clients = fakeClients();
    let release!: (c: unknown) => void;
    buildClientsMock.mockReturnValue(
      new Promise<never>((resolve) => {
        release = resolve as (c: unknown) => void;
      }),
    );

    useAuthStore.setState({ authed: true });
    renderHook(() => useBootstrap());

    // Log out while buildClients() is still pending: the effect cleanup runs before the client exists.
    await act(async () => {
      useAuthStore.setState({ authed: false });
    });

    await act(async () => {
      release(clients);
    });

    expect(clients.realtime.disconnect).toHaveBeenCalledTimes(1);
    expect(getClients()).toBeNull();
  });
});
