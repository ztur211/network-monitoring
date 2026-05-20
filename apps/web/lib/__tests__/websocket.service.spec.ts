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
