import { io as defaultIo, type Socket } from 'socket.io-client';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';
type Listener = (...args: unknown[]) => void;
type IoFactory = (url: string, opts: Record<string, unknown>) => Socket;

export interface RealtimeClientOptions {
  baseUrl: string;
  /** Bearer auth (desktop): resolved per connect and sent as socket.io handshake `auth.token`. */
  getToken?: () => string | null | Promise<string | null>;
  /** Cookie auth (web): send credentials with the handshake. */
  withCredentials?: boolean;
  transports?: ('websocket' | 'polling')[];
  reconnection?: {
    attempts?: number;
    delay?: number;
    delayMax?: number;
    randomizationFactor?: number;
  };
  /** UI binding for connection state (connected / reconnecting / offline). */
  onStatus?: (status: ConnectionStatus) => void;
  /** Heartbeat: emit `event`, await `pongEvent` once, report the round-trip via onLatency. */
  ping?: { event: string; pongEvent: string; intervalMs: number; onLatency?: (ms: number) => void };
  /** After socket.io exhausts its reconnection attempts, retry connect() after this delay. */
  offlineRetryMs?: number;
  /** Injectable socket factory — lets a host pass its own (mocked) `io` so its mock survives the package boundary. */
  io?: IoFactory;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number;
}

export interface RealtimeClient {
  connect(): Promise<void>;
  disconnect(): void;
  on<T = unknown>(event: string, listener: (data: T) => void): void;
  off(event: string, listener?: Listener): void;
  /** Register `handler` and return an unsubscribe that removes exactly that handler. */
  subscribe<T = unknown>(event: string, handler: (data: T) => void): () => void;
  emit(event: string, payload?: unknown): void;
  removeAllListeners(event?: string): void;
}

// socket.io-client v4 fires these on the Manager (`socket.io`), not the Socket.
// Subscribing them on the Socket silently no-ops — route them to the Manager.
const MANAGER_EVENTS = new Set(['reconnect', 'reconnect_attempt', 'reconnect_error', 'reconnect_failed', 'ping']);

/**
 * Transport-agnostic realtime client shared by the web app and the desktop viewer. The socket
 * lifecycle is the same algorithm for both — a subscriber registry that survives disconnect/reconnect,
 * Manager-vs-Socket event routing, a double-subscribe guard, orphan-socket teardown, an optional ping
 * loop, and optional offline retry. The parts that genuinely differ are injected: auth (bearer token
 * vs cookies), transports, and the status/latency side-effects (each app binds these to its own store).
 *
 * This consolidates two prior copies (web's WebSocketService and the desktop's thin client); the
 * behaviour is the web implementation's, whose regression suite documents the subtle bugs it fixed.
 */
class RealtimeClientImpl implements RealtimeClient {
  private socket: Socket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private offlineRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly socketSubscribers = new Map<string, Set<Listener>>();
  private readonly managerSubscribers = new Map<string, Set<Listener>>();
  private readonly io: IoFactory;
  private readonly now: () => number;

  constructor(private readonly opts: RealtimeClientOptions) {
    this.io = opts.io ?? (defaultIo as unknown as IoFactory);
    this.now = opts.now ?? Date.now;
  }

  async connect(): Promise<void> {
    if (this.socket?.connected) return;

    // Tear down any half-open socket before creating a fresh one. Otherwise the orphan keeps its
    // transport alive and — since attachRegisteredSubscribers wired every user handler onto it —
    // could double-fire app-level events when its background connect completes.
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    // Resolve bearer token (desktop) without awaiting at all on the cookie path (web), so a
    // synchronous connect() still creates the socket before returning (the web suite relies on this).
    const auth = this.opts.getToken ? { token: await this.opts.getToken() } : undefined;
    const r = this.opts.reconnection;

    this.socket = this.io(this.opts.baseUrl, {
      ...(this.opts.withCredentials ? { withCredentials: true } : {}),
      ...(auth ? { auth } : {}),
      transports: this.opts.transports ?? ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: r?.attempts ?? Infinity,
      reconnectionDelay: r?.delay ?? 1_000,
      reconnectionDelayMax: r?.delayMax ?? 10_000,
      randomizationFactor: r?.randomizationFactor ?? 0.5,
    });

    this.socket.on('connect', () => {
      this.opts.onStatus?.('connected');
      this.startPingLoop();
    });
    this.socket.on('disconnect', () => {
      this.stopPingLoop();
      this.opts.onStatus?.('reconnecting');
    });
    this.socket.io.on('reconnect', () => {
      this.opts.onStatus?.('connected');
      this.startPingLoop();
    });
    this.socket.io.on('reconnect_failed', () => {
      this.opts.onStatus?.('offline');
      this.scheduleOfflineRetry();
    });

    this.attachRegisteredSubscribers();
  }

  disconnect(): void {
    this.stopPingLoop();
    this.clearOfflineRetry();
    this.socket?.disconnect();
    this.socket = null;
  }

  on<T = unknown>(event: string, listener: (data: T) => void): void {
    const cb = listener as Listener;
    const registry = MANAGER_EVENTS.has(event) ? this.managerSubscribers : this.socketSubscribers;
    let bucket = registry.get(event);
    if (!bucket) {
      bucket = new Set();
      registry.set(event, bucket);
    }
    // Skip if already registered: the Set dedups the registry, but Node's EventEmitter would happily
    // attach the same listener twice (and fire it twice), leaving an unremovable orphan after off().
    if (bucket.has(cb)) return;
    bucket.add(cb);

    if (!this.socket) return;
    if (MANAGER_EVENTS.has(event)) {
      (this.socket.io.on as (e: string, l: Listener) => void)(event, cb);
    } else {
      this.socket.on(event, cb);
    }
  }

  off(event: string, listener?: Listener): void {
    const registry = MANAGER_EVENTS.has(event) ? this.managerSubscribers : this.socketSubscribers;
    if (listener) registry.get(event)?.delete(listener);
    else registry.delete(event);

    if (!this.socket) return;
    if (MANAGER_EVENTS.has(event)) {
      (this.socket.io.off as (e: string, l?: Listener) => void)(event, listener);
    } else {
      this.socket.off(event, listener);
    }
  }

  subscribe<T = unknown>(event: string, handler: (data: T) => void): () => void {
    this.on(event, handler);
    return () => this.off(event, handler as Listener);
  }

  emit(event: string, payload?: unknown): void {
    this.socket?.emit(event, payload);
  }

  removeAllListeners(event?: string): void {
    const managerOff = this.socket?.io.off as ((e: string, l?: Listener) => void) | undefined;
    if (event !== undefined) {
      const registry = MANAGER_EVENTS.has(event) ? this.managerSubscribers : this.socketSubscribers;
      registry.delete(event);
      if (this.socket) {
        if (MANAGER_EVENTS.has(event)) managerOff?.(event);
        else this.socket.off(event);
      }
      return;
    }
    for (const e of this.socketSubscribers.keys()) this.socket?.off(e);
    for (const e of this.managerSubscribers.keys()) managerOff?.(e);
    this.socketSubscribers.clear();
    this.managerSubscribers.clear();
  }

  private attachRegisteredSubscribers(): void {
    if (!this.socket) return;
    for (const [event, listeners] of this.socketSubscribers) {
      for (const listener of listeners) this.socket.on(event, listener);
    }
    for (const [event, listeners] of this.managerSubscribers) {
      for (const listener of listeners) {
        (this.socket.io.on as (e: string, l: Listener) => void)(event, listener);
      }
    }
  }

  private startPingLoop(): void {
    const ping = this.opts.ping;
    if (!ping) return;
    this.stopPingLoop();
    this.pingTimer = setInterval(() => {
      const sentAt = this.now();
      this.socket?.emit(ping.event);
      this.socket?.once(ping.pongEvent, () => ping.onLatency?.(this.now() - sentAt));
    }, ping.intervalMs);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleOfflineRetry(): void {
    if (this.opts.offlineRetryMs === undefined) return;
    this.clearOfflineRetry();
    this.offlineRetryTimer = setTimeout(() => this.socket?.connect(), this.opts.offlineRetryMs);
  }

  private clearOfflineRetry(): void {
    if (this.offlineRetryTimer !== null) {
      clearTimeout(this.offlineRetryTimer);
      this.offlineRetryTimer = null;
    }
  }
}

export function createRealtimeClient(opts: RealtimeClientOptions): RealtimeClient {
  return new RealtimeClientImpl(opts);
}
