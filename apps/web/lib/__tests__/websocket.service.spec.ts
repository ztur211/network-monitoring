/**
 * Regression test for the dead-code bug fixed in 2026-05-20: in socket.io-client
 * v4, the `reconnect` and `reconnect_failed` events fire on the Manager
 * (accessible via `socket.io`), not the Socket. Before the fix,
 * `websocketService.on('reconnect', cb)` delegated to `socket.on(...)` which
 * never fires.
 *
 * Mocks both `socket.io-client` (separate Socket and Manager emitters) and
 * `ui.store`, then verifies that:
 *   - Subscribing to a Manager event ('reconnect', 'reconnect_failed') via
 *     `websocketService.on(...)` routes to the Manager emitter.
 *   - Subscribing to a Socket event ('connect') still routes to the Socket.
 *   - `off` symmetrically routes to the same emitter.
 */
import { EventEmitter } from 'node:events';
// `unstable_mockModule` is on @jest/globals but missing from @types/jest's
// global namespace — cast to access it without losing the looser global types
// the rest of the suite uses.
const jestEsm = jest as typeof jest & {
  unstable_mockModule: (moduleName: string, factory: () => unknown) => void;
};

let mockSocket: ReturnType<typeof makeMockSocket>;

function makeMockSocket() {
  const socketEmitter = new EventEmitter();
  const managerEmitter = new EventEmitter();
  const socket = {
    connected: false,
    on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
      socketEmitter.on(event, listener);
      return socket;
    }),
    off: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
      socketEmitter.off(event, listener);
      return socket;
    }),
    once: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    io: {
      on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
        managerEmitter.on(event, listener);
        return socket.io;
      }),
      off: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
        managerEmitter.off(event, listener);
        return socket.io;
      }),
      _emit: (event: string, ...args: unknown[]) => managerEmitter.emit(event, ...args),
    },
    _emit: (event: string, ...args: unknown[]) => socketEmitter.emit(event, ...args),
  };
  return socket;
}

jestEsm.unstable_mockModule('socket.io-client', () => ({
  io: jest.fn(() => {
    mockSocket = makeMockSocket();
    return mockSocket;
  }),
}));

// ui.store is stubbed via jest.config moduleNameMapper (see jest.config.ts) —
// avoids pulling in Zustand/React in this pure-logic test.

const { websocketService } = await import('../websocket.service');

describe('WebSocketService — Manager-vs-Socket event routing', () => {
  beforeEach(() => {
    websocketService.connect();
  });

  afterEach(() => {
    websocketService.disconnect();
    websocketService.removeAllListeners();
    jest.clearAllMocks();
  });

  it("'reconnect' fires when the Manager emits — NOT when Socket does", () => {
    const handler = jest.fn();
    websocketService.on('reconnect', handler);

    // Wrong path (what the old dead-code subscription did): Socket emits.
    mockSocket._emit('reconnect');
    expect(handler).not.toHaveBeenCalled();

    // Right path: Manager emits.
    mockSocket.io._emit('reconnect', 1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("'reconnect_failed' fires when the Manager emits", () => {
    const handler = jest.fn();
    websocketService.on('reconnect_failed', handler);

    mockSocket.io._emit('reconnect_failed');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("'connect' still routes to the Socket (not Manager)", () => {
    const handler = jest.fn();
    websocketService.on('connect', handler);

    mockSocket._emit('connect');
    expect(handler).toHaveBeenCalledTimes(1);

    mockSocket.io._emit('connect');
    expect(handler).toHaveBeenCalledTimes(1); // unchanged
  });

  it("off('reconnect', handler) unsubscribes from the Manager", () => {
    const handler = jest.fn();
    websocketService.on('reconnect', handler);
    websocketService.off('reconnect', handler);

    mockSocket.io._emit('reconnect');
    expect(handler).not.toHaveBeenCalled();
  });

  it("off('connect', handler) unsubscribes from the Socket", () => {
    const handler = jest.fn();
    websocketService.on('connect', handler);
    websocketService.off('connect', handler);

    mockSocket._emit('connect');
    expect(handler).not.toHaveBeenCalled();
  });
});

/**
 * Regression tests for the subscriber-buffering bug. Before the fix,
 * `websocketService.on(...)` returned early when `this.socket` was null, so any
 * subscription registered before `connect()` ran was silently dropped. This bit
 * `_layout.tsx`, where four entity/AI subscribers were registered synchronously
 * outside the async `authClient.getSession().then(...)` block — they all
 * no-op'd and live updates from the server were dropped on the floor.
 *
 * After the fix, on/off mutate a service-level registry. connect() re-attaches
 * the registry to whichever fresh socket it just created, so subscriptions
 * survive both the pre-connect window and disconnect→reconnect cycles.
 */
describe('WebSocketService — subscriber buffering across connect lifecycle', () => {
  afterEach(() => {
    websocketService.disconnect();
    // Clear the singleton's subscriber registries between tests — disconnect()
    // intentionally keeps them around (so callers can reconnect and have their
    // handlers re-attach), but in tests that means handler closures from
    // earlier tests get re-attached to later tests' fresh mockSockets.
    websocketService.removeAllListeners();
    jest.clearAllMocks();
  });

  it('Socket subscriptions registered BEFORE connect() fire on emit after connect', () => {
    const handler = jest.fn();
    websocketService.on('v1:device:updated', handler);

    websocketService.connect();
    mockSocket._emit('v1:device:updated', { device: { id: 'd1' } });

    expect(handler).toHaveBeenCalledWith({ device: { id: 'd1' } });
  });

  it('Manager subscriptions registered BEFORE connect() fire on Manager emit after connect', () => {
    const handler = jest.fn();
    websocketService.on('reconnect', handler);

    websocketService.connect();
    mockSocket.io._emit('reconnect', 1);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('off() before connect() cancels a buffered subscription', () => {
    const handler = jest.fn();
    websocketService.on('v1:device:updated', handler);
    websocketService.off('v1:device:updated', handler);

    websocketService.connect();
    mockSocket._emit('v1:device:updated', { device: { id: 'd1' } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('subscriptions survive disconnect → connect (re-attach to the new socket)', () => {
    const handler = jest.fn();
    websocketService.on('v1:device:updated', handler);

    websocketService.connect();
    const firstSocket = mockSocket;
    mockSocket._emit('v1:device:updated', { device: { id: 'd1' } });
    expect(handler).toHaveBeenCalledTimes(1);

    websocketService.disconnect();
    websocketService.connect();
    expect(mockSocket).not.toBe(firstSocket);

    mockSocket._emit('v1:device:updated', { device: { id: 'd2' } });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith({ device: { id: 'd2' } });
  });

  it('Manager subscriptions also survive disconnect → connect', () => {
    const handler = jest.fn();
    websocketService.on('reconnect', handler);

    websocketService.connect();
    mockSocket.io._emit('reconnect', 1);
    expect(handler).toHaveBeenCalledTimes(1);

    websocketService.disconnect();
    websocketService.connect();
    mockSocket.io._emit('reconnect', 2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('on(event, handler) called twice with the same handler attaches socket.on only once', () => {
    websocketService.connect();
    const handler = jest.fn();
    websocketService.on('v1:device:updated', handler);
    websocketService.on('v1:device:updated', handler);

    mockSocket._emit('v1:device:updated', { device: { id: 'd1' } });

    // Without the dedup guard, Node EventEmitter would fire the listener twice.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('connect() called while a previous socket exists tears down the orphan before creating a new one', () => {
    websocketService.connect();
    const firstSocket = mockSocket;

    // Second connect() while firstSocket hasn't fully connected (mock leaves
    // connected=false) — without the teardown, firstSocket is orphaned but
    // still has its internal handlers AND any registered user handlers
    // attached, so it can fire events after a new socket is in place.
    websocketService.connect();

    expect(firstSocket.disconnect).toHaveBeenCalled();
    expect(mockSocket).not.toBe(firstSocket);
  });

  it('removeAllListeners() clears Socket and Manager registries; subsequent connect() does not re-attach', () => {
    const sockHandler = jest.fn();
    const mgrHandler = jest.fn();
    websocketService.on('v1:device:updated', sockHandler);
    websocketService.on('reconnect', mgrHandler);

    websocketService.removeAllListeners();

    websocketService.connect();
    mockSocket._emit('v1:device:updated', { device: { id: 'd1' } });
    mockSocket.io._emit('reconnect', 1);

    expect(sockHandler).not.toHaveBeenCalled();
    expect(mgrHandler).not.toHaveBeenCalled();
  });
});
