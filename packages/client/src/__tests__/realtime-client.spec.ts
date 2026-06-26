import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRealtimeClient } from '../realtime-client';

// A socket.io-client double with separate Socket and Manager emitters (the Manager is `socket.io`),
// plus a controllable once() so the ping/pong round-trip can be driven from tests.
function makeMockSocket() {
  const socketEmitter = new EventEmitter();
  const managerEmitter = new EventEmitter();
  const onceHandlers = new Map<string, () => void>();
  const socket = {
    connected: false,
    on: vi.fn((e: string, l: (...a: unknown[]) => void) => (socketEmitter.on(e, l), socket)),
    off: vi.fn((e: string, l?: (...a: unknown[]) => void) => (l ? socketEmitter.off(e, l) : socketEmitter.removeAllListeners(e), socket)),
    once: vi.fn((e: string, l: () => void) => onceHandlers.set(e, l)),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((e: string, l: (...a: unknown[]) => void) => (managerEmitter.on(e, l), socket.io)),
      off: vi.fn((e: string, l?: (...a: unknown[]) => void) => (l ? managerEmitter.off(e, l) : managerEmitter.removeAllListeners(e), socket.io)),
      _emit: (e: string, ...a: unknown[]) => managerEmitter.emit(e, ...a),
    },
    _emit: (e: string, ...a: unknown[]) => socketEmitter.emit(e, ...a),
    _firePong: (e: string) => onceHandlers.get(e)?.(),
  };
  return socket;
}

let sockets: ReturnType<typeof makeMockSocket>[];
let ioMock: ReturnType<typeof vi.fn>;
const newClient = (opts: Record<string, unknown> = {}) =>
  createRealtimeClient({ baseUrl: 'http://api', io: ioMock as never, ...opts });

beforeEach(() => {
  sockets = [];
  ioMock = vi.fn(() => {
    const s = makeMockSocket();
    sockets.push(s);
    return s;
  });
});
const last = () => sockets[sockets.length - 1];

describe('createRealtimeClient — handshake', () => {
  it('sends a bearer token (desktop) resolved from getToken', async () => {
    const rt = newClient({ getToken: () => 'TKN', transports: ['websocket'] });
    await rt.connect();
    expect(ioMock).toHaveBeenCalledWith('http://api', expect.objectContaining({ auth: { token: 'TKN' }, transports: ['websocket'] }));
  });

  it('sends cookies (web) when withCredentials, no auth block', async () => {
    const rt = newClient({ withCredentials: true });
    await rt.connect();
    const opts = ioMock.mock.calls[0][1];
    expect(opts.withCredentials).toBe(true);
    expect(opts.auth).toBeUndefined();
  });

  it('connect() aborted by disconnect() during getToken does not orphan a live socket', async () => {
    let resolveToken!: (v: string) => void;
    const getToken = () => new Promise<string>((r) => { resolveToken = r; });
    const rt = newClient({ getToken });

    const pending = rt.connect(); // suspends on the awaited getToken
    rt.disconnect();              // bumps the generation while connect is suspended
    resolveToken('TKN');
    await pending;

    // The stale attempt bailed before building a socket — no orphan firing app events.
    expect(ioMock).not.toHaveBeenCalled();
  });
});

describe('createRealtimeClient — Manager vs Socket routing', () => {
  let rt: ReturnType<typeof newClient>;
  beforeEach(async () => {
    rt = newClient();
    await rt.connect();
  });
  afterEach(() => {
    rt.disconnect();
    rt.removeAllListeners();
  });

  it("'reconnect' fires on the Manager, not the Socket", () => {
    const h = vi.fn();
    rt.on('reconnect', h);
    last()._emit('reconnect');
    expect(h).not.toHaveBeenCalled();
    last().io._emit('reconnect', 1);
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("'connect' routes to the Socket", () => {
    const h = vi.fn();
    rt.on('connect', h);
    last()._emit('connect');
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('off routes symmetrically (Manager event)', () => {
    const h = vi.fn();
    rt.on('reconnect', h);
    rt.off('reconnect', h);
    last().io._emit('reconnect');
    expect(h).not.toHaveBeenCalled();
  });
});

describe('createRealtimeClient — subscriber registry across lifecycle', () => {
  it('subscriptions registered BEFORE connect fire after connect', async () => {
    const rt = newClient();
    const h = vi.fn();
    rt.on('v1:device:updated', h);
    await rt.connect();
    last()._emit('v1:device:updated', { id: 'd1' });
    expect(h).toHaveBeenCalledWith({ id: 'd1' });
  });

  it('off() before connect cancels a buffered subscription', async () => {
    const rt = newClient();
    const h = vi.fn();
    rt.on('v1:device:updated', h);
    rt.off('v1:device:updated', h);
    await rt.connect();
    last()._emit('v1:device:updated', { id: 'd1' });
    expect(h).not.toHaveBeenCalled();
  });

  it('subscribe() returns an unsubscribe that removes the handler', async () => {
    const rt = newClient();
    const h = vi.fn();
    const unsub = rt.subscribe('v1:device:updated', h);
    await rt.connect();
    last()._emit('v1:device:updated', { id: 'd1' });
    expect(h).toHaveBeenCalledTimes(1);
    unsub();
    last()._emit('v1:device:updated', { id: 'd2' });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('subscriptions survive disconnect → connect (re-attach to the new socket)', async () => {
    const rt = newClient();
    const h = vi.fn();
    rt.on('v1:device:updated', h);
    await rt.connect();
    const first = last();
    first._emit('v1:device:updated', { id: 'd1' });
    rt.disconnect();
    await rt.connect();
    expect(last()).not.toBe(first);
    last()._emit('v1:device:updated', { id: 'd2' });
    expect(h).toHaveBeenCalledTimes(2);
  });

  it('on() twice with the same handler attaches socket.on only once', async () => {
    const rt = newClient();
    await rt.connect();
    const h = vi.fn();
    rt.on('v1:device:updated', h);
    rt.on('v1:device:updated', h);
    last()._emit('v1:device:updated', { id: 'd1' });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('connect() while a previous socket exists tears down the orphan', async () => {
    const rt = newClient();
    await rt.connect();
    const first = last();
    await rt.connect();
    expect(first.disconnect).toHaveBeenCalled();
    expect(last()).not.toBe(first);
  });

  it('removeAllListeners() clears both registries; next connect does not re-attach', async () => {
    const rt = newClient();
    const sock = vi.fn();
    const mgr = vi.fn();
    rt.on('v1:device:updated', sock);
    rt.on('reconnect', mgr);
    rt.removeAllListeners();
    await rt.connect();
    last()._emit('v1:device:updated', { id: 'd1' });
    last().io._emit('reconnect', 1);
    expect(sock).not.toHaveBeenCalled();
    expect(mgr).not.toHaveBeenCalled();
  });
});

describe('createRealtimeClient — status, ping, offline retry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports connection status transitions via onStatus', async () => {
    const onStatus = vi.fn();
    const rt = newClient({ onStatus });
    await rt.connect();
    last()._emit('connect');
    last()._emit('disconnect');
    last().io._emit('reconnect_failed');
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual(['connected', 'reconnecting', 'offline']);
  });

  it('ping loop emits and reports latency from the pong round-trip', async () => {
    let t = 1000;
    const onLatency = vi.fn();
    const rt = newClient({
      now: () => t,
      ping: { event: 'v1:ping', pongEvent: 'v1:pong', intervalMs: 25_000, onLatency },
    });
    await rt.connect();
    last()._emit('connect'); // starts the ping loop
    vi.advanceTimersByTime(25_000);
    expect(last().emit).toHaveBeenCalledWith('v1:ping');
    t = 1042; // 42ms later
    last()._emit('v1:pong'); // persistent pong listener (no longer a per-tick once)
    expect(onLatency).toHaveBeenCalledWith(42);
  });

  it('does not leak a pong listener per missed pong, and reports latency at most once when pongs resume', async () => {
    let t = 1000;
    const onLatency = vi.fn();
    const rt = newClient({
      now: () => t,
      ping: { event: 'v1:ping', pongEvent: 'v1:pong', intervalMs: 25_000, onLatency },
    });
    await rt.connect();
    last()._emit('connect');

    // Five intervals elapse with NO pong arriving.
    for (let i = 0; i < 5; i++) {
      t += 25_000;
      vi.advanceTimersByTime(25_000);
    }
    // Exactly one persistent pong listener exists (a per-tick `once` would have stacked 5).
    const pongOnCalls = last().on.mock.calls.filter((c) => c[0] === 'v1:pong');
    expect(pongOnCalls).toHaveLength(1);

    // When a pong finally arrives, latency is reported once — not once per missed tick.
    last()._emit('v1:pong');
    expect(onLatency).toHaveBeenCalledTimes(1);
  });

  it('stopPingLoop removes the pong listener (no leak across disconnect)', async () => {
    const rt = newClient({
      ping: { event: 'v1:ping', pongEvent: 'v1:pong', intervalMs: 25_000, onLatency: vi.fn() },
    });
    await rt.connect();
    last()._emit('connect');
    const sock = last();
    rt.disconnect();
    expect(sock.off).toHaveBeenCalledWith('v1:pong', expect.any(Function));
  });

  it('schedules an offline retry after reconnect_failed', async () => {
    const rt = newClient({ offlineRetryMs: 30_000 });
    await rt.connect();
    last().io._emit('reconnect_failed');
    expect(last().connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(last().connect).toHaveBeenCalled();
  });
});
