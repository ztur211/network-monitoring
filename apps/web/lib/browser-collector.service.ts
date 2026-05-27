import { WS_EVENTS } from '@nodescope/shared';
import { websocketService } from './websocket.service';
import { useRealtimeStore } from '../store/realtime.store';
import { getBrowserDeviceId } from './browser-device-id';

const COLLECT_INTERVAL_MS = 30_000;
const BANDWIDTH_PAYLOAD_BYTES = 100_000; // 100 KB test payload
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

interface NetworkInformation {
  effectiveType?: string;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

declare global {
  interface Navigator {
    connection?: NetworkInformation;
  }
}

class BrowserCollectorService {
  private collectTimer: ReturnType<typeof setInterval> | null = null;
  private isVisible = true;

  start(): void {
    this.setupVisibilityListener();
    this.scheduleCollection();
  }

  stop(): void {
    this.clearTimer();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private setupVisibilityListener(): void {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.isVisible = document.visibilityState === 'visible';
  }

  private handleVisibilityChange = (): void => {
    this.isVisible = document.visibilityState === 'visible';
    if (this.isVisible) {
      this.scheduleCollection();
    } else {
      this.clearTimer();
    }
  };

  private scheduleCollection(): void {
    this.clearTimer();
    if (!this.isVisible) return;
    this.collectTimer = setInterval(() => {
      void this.collectAndSubmit();
    }, COLLECT_INTERVAL_MS);
  }

  private clearTimer(): void {
    if (this.collectTimer !== null) {
      clearInterval(this.collectTimer);
      this.collectTimer = null;
    }
  }

  private async collectAndSubmit(): Promise<void> {
    if (!this.isVisible) return;

    const [latency, bandwidth, connectionQuality] = await Promise.all([
      this.measureLatency(),
      this.measureBandwidth(),
      Promise.resolve(this.getConnectionQuality()),
    ]);

    // The gateway resolves browserDeviceId → deviceId via
    // DevicesService.findDeviceIdByBrowserDeviceId before forwarding to ingest.
    // Pre-onboarding the lookup returns null and the metric is stored against
    // the user without a deviceId — still useful, just unattributed.
    websocketService.emit(WS_EVENTS.METRICS_SUBMIT, {
      browserDeviceId: getBrowserDeviceId(),
      ...(latency !== null && { latency }),
      ...(bandwidth.down !== null && { bandwidthDown: bandwidth.down }),
      ...(bandwidth.up !== null && { bandwidthUp: bandwidth.up }),
      ...(connectionQuality !== null && { connectionQuality }),
    });
  }

  private measureLatency(): Promise<number | null> {
    return new Promise((resolve) => {
      const sentAt = Date.now();
      let timeout: ReturnType<typeof setTimeout>;
      const listener = (): void => {
        clearTimeout(timeout);
        websocketService.off(WS_EVENTS.PONG, listener);
        resolve(Date.now() - sentAt);
      };
      timeout = setTimeout(() => {
        websocketService.off(WS_EVENTS.PONG, listener);
        resolve(null);
      }, 5_000);
      websocketService.on(WS_EVENTS.PONG, listener);
      websocketService.emit(WS_EVENTS.PING);
    });
  }

  private async measureBandwidth(): Promise<{ down: number | null; up: number | null }> {
    try {
      const startDown = Date.now();
      const res = await fetch(`${API_URL}/api/bandwidth/echo`, { cache: 'no-store' });
      const body = await res.arrayBuffer();
      const elapsedDownMs = Date.now() - startDown;
      const bytesDown = body.byteLength;
      const mbpsDown = (bytesDown * 8) / (elapsedDownMs / 1000) / 1_000_000;

      const uploadPayload = new Uint8Array(BANDWIDTH_PAYLOAD_BYTES);
      const startUp = Date.now();
      await fetch(`${API_URL}/api/bandwidth/echo`, {
        method: 'POST',
        body: uploadPayload,
        cache: 'no-store',
      }).catch(() => null);
      const elapsedUpMs = Date.now() - startUp;
      const mbpsUp = (BANDWIDTH_PAYLOAD_BYTES * 8) / (elapsedUpMs / 1000) / 1_000_000;

      return { down: parseFloat(mbpsDown.toFixed(2)), up: parseFloat(mbpsUp.toFixed(2)) };
    } catch {
      return { down: null, up: null };
    }
  }

  private getConnectionQuality(): string | null {
    const connection = navigator.connection;
    if (!connection?.effectiveType) return null;
    const validTypes = ['4g', '3g', '2g', 'slow-2g'];
    return validTypes.includes(connection.effectiveType) ? connection.effectiveType : 'unknown';
  }
}

export const browserCollectorService = new BrowserCollectorService();

export function subscribeToMetricsUpdates(): () => void {
  const handler = (data: { metrics: import('@nodescope/shared').MetricsDto; sourceTypes: string[] }) => {
    useRealtimeStore.getState().setMetrics(data.metrics, data.sourceTypes);
  };
  websocketService.on(WS_EVENTS.METRICS_UPDATE, handler);
  return () => websocketService.off(WS_EVENTS.METRICS_UPDATE, handler as (...args: unknown[]) => void);
}
