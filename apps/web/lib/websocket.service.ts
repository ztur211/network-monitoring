import { io, Socket } from 'socket.io-client';
import { WS_EVENTS } from '@nodescope/shared';
import { useUiStore } from '../store/ui.store';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const PING_INTERVAL_MS = 25_000;
const OFFLINE_RETRY_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

class WebSocketService {
  private socket: Socket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private offlineRetryTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (this.socket?.connected) return;

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

    this.socket.on('reconnect', () => {
      useUiStore.getState().setConnectionStatus('connected');
      this.startPingLoop();
    });

    this.socket.on('reconnect_failed', () => {
      useUiStore.getState().setConnectionStatus('offline');
      this.scheduleOfflineRetry();
    });
  }

  disconnect(): void {
    this.stopPingLoop();
    this.clearOfflineRetry();
    this.socket?.disconnect();
    this.socket = null;
  }

  on<T = unknown>(event: string, listener: (data: T) => void): void {
    this.socket?.on(event, listener as (...args: unknown[]) => void);
  }

  off(event: string, listener?: (...args: unknown[]) => void): void {
    this.socket?.off(event, listener);
  }

  emit(event: string, payload?: unknown): void {
    this.socket?.emit(event, payload);
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
