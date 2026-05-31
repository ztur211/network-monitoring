import { io, Socket } from 'socket.io-client';
import { WS_EVENTS } from '@nodescope/shared';
import { useUiStore } from '../store/ui.store';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const PING_INTERVAL_MS = 25_000;
const OFFLINE_RETRY_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

// socket.io-client v4 emits these on the Manager (`socket.io`), not the Socket.
// Subscribing them on the Socket silently no-ops. Route them to the Manager.
const MANAGER_EVENTS = new Set([
  'reconnect',
  'reconnect_attempt',
  'reconnect_error',
  'reconnect_failed',
  'ping',
]);

type Listener = (...args: unknown[]) => void;

class WebSocketService {
  private socket: Socket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private offlineRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // Subscriber registry. Survives disconnect/reconnect so that callers can
  // register handlers before connect() has run (e.g. synchronously from a
  // useEffect that also kicks off async session bootstrap) without those
  // subscriptions being silently dropped. connect() re-attaches the registry
  // to each fresh socket.
  private readonly socketSubscribers = new Map<string, Set<Listener>>();
  private readonly managerSubscribers = new Map<string, Set<Listener>>();

  connect(): void {
    if (this.socket?.connected) return;

    // Tear down any half-open socket (still connecting, or terminally
    // disconnected after a reconnect_failed) before creating a fresh one.
    // Otherwise the orphan keeps its transport alive and — since
    // attachRegisteredSubscribers wired every user handler onto it — could
    // double-fire app-level events when its background connect completes.
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.socket = io(API_URL, {
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.5,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      useUiStore.getState().setConnectionStatus('connected');
      this.startPingLoop();
    });

    this.socket.on('disconnect', () => {
      this.stopPingLoop();
      useUiStore.getState().setConnectionStatus('reconnecting');
    });

    this.socket.io.on('reconnect', () => {
      useUiStore.getState().setConnectionStatus('connected');
      this.startPingLoop();
    });

    this.socket.io.on('reconnect_failed', () => {
      useUiStore.getState().setConnectionStatus('offline');
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
    const registry = MANAGER_EVENTS.has(event)
      ? this.managerSubscribers
      : this.socketSubscribers;

    let bucket = registry.get(event);
    if (!bucket) {
      bucket = new Set();
      registry.set(event, bucket);
    }
    // Skip the socket.on() call if this exact listener is already registered.
    // Without the guard, calling on(e, h) both pre- and post-connect would
    // attach h to the socket twice (Set dedups the registry but Node's
    // EventEmitter happily registers the same listener twice and fires it
    // twice), leaving an orphan listener after off() that the service can no
    // longer remove.
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
    const registry = MANAGER_EVENTS.has(event)
      ? this.managerSubscribers
      : this.socketSubscribers;

    if (listener) {
      registry.get(event)?.delete(listener);
    } else {
      registry.delete(event);
    }

    if (!this.socket) return;
    if (MANAGER_EVENTS.has(event)) {
      (this.socket.io.off as (e: string, l?: Listener) => void)(event, listener);
    } else {
      this.socket.off(event, listener);
    }
  }

  /**
   * Registers `handler` for `event` and returns an unsubscribe function that
   * removes exactly that handler. Wraps the on/return-off-with-cast dance the
   * feature subscribe* helpers all repeat.
   */
  subscribe<T = unknown>(event: string, handler: (data: T) => void): () => void {
    this.on(event, handler);
    return () => this.off(event, handler as Listener);
  }

  emit(event: string, payload?: unknown): void {
    this.socket?.emit(event, payload);
  }

  removeAllListeners(event?: string): void {
    const managerOff = this.socket?.io.off as
      | ((e: string, l?: Listener) => void)
      | undefined;

    if (event !== undefined) {
      const registry = MANAGER_EVENTS.has(event)
        ? this.managerSubscribers
        : this.socketSubscribers;
      registry.delete(event);
      if (this.socket) {
        if (MANAGER_EVENTS.has(event)) {
          managerOff?.(event);
        } else {
          this.socket.off(event);
        }
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
    this.stopPingLoop();
    this.pingTimer = setInterval(() => {
      const sentAt = Date.now();
      this.socket?.emit(WS_EVENTS.PING);
      this.socket?.once(WS_EVENTS.PONG, () => {
        useUiStore.getState().setLatency(Date.now() - sentAt);
      });
    }, PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleOfflineRetry(): void {
    this.clearOfflineRetry();
    this.offlineRetryTimer = setTimeout(() => {
      this.socket?.connect();
    }, OFFLINE_RETRY_DELAY_MS);
  }

  private clearOfflineRetry(): void {
    if (this.offlineRetryTimer !== null) {
      clearTimeout(this.offlineRetryTimer);
      this.offlineRetryTimer = null;
    }
  }
}

export const websocketService = new WebSocketService();
