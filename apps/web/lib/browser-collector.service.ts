import { WS_EVENTS, nonOverlapping } from '@nodescope/shared';
import { websocketService } from './websocket.service';
import { useRealtimeStore } from '../store/realtime.store';
import { getBrowserDeviceId } from './browser-device-id';
import { resolveApiBaseUrl } from './api-base';

const COLLECT_INTERVAL_MS = 30_000;
const BANDWIDTH_PAYLOAD_BYTES = 100_000; // 100 KB test payload
// A bandwidth probe is bounded by this timeout, not by the server's goodwill: an
// origin that accepts the connection and never answers (hung API, captive portal,
// black-holed route - the degraded network this collector exists to measure) would
// otherwise leave the fetch pending forever. Download and upload run back to back,
// so the worst case is 20s, comfortably inside COLLECT_INTERVAL_MS.
const BANDWIDTH_TIMEOUT_MS = 10_000;
const API_URL = resolveApiBaseUrl();

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

  // One cycle at a time, for the lifetime of the service: a slow cycle must not have
  // the next tick stacked on top of it. Every in-flight cycle holds its 100 KB upload
  // buffer and its downloaded payload, and the browser's 6-connections-per-origin cap
  // means stacked probes queue ahead of the app's own REST calls - which makes each
  // cycle slower, which causes more overlap. Skipping the tick keeps the cost flat at
  // one cycle and degrades by collecting less often, the honest outcome.
  // Built once as a field (not per scheduleCollection) so the guard survives the
  // clear/reschedule that a visibility change does while a cycle is still running.
  private readonly runCollection = nonOverlapping(
    () => this.collectAndSubmit(),
    () => {
      console.warn('[browser-collector] previous cycle still in flight, skipping this tick');
    },
  );

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
      void this.runCollection().catch((error) => {
        // A rejection must not escape the interval callback as an unhandled rejection.
        console.warn('[browser-collector] collection cycle failed', error);
      });
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
      const listener = (): void => {
        clearTimeout(timeout);
        websocketService.off(WS_EVENTS.PONG, listener);
        resolve(Date.now() - sentAt);
      };
      const timeout = setTimeout(() => {
        websocketService.off(WS_EVENTS.PONG, listener);
        resolve(null);
      }, 5_000);
      websocketService.on(WS_EVENTS.PONG, listener);
      websocketService.emit(WS_EVENTS.PING);
    });
  }

  private async measureBandwidth(): Promise<{ down: number | null; up: number | null }> {
    // Sequential: measuring both directions at once would have them contend for the
    // same link and report half the truth for each.
    const down = await this.measureDownload();
    const up = await this.measureUpload();
    return { down, up };
  }

  private measureDownload(): Promise<number | null> {
    return this.withTimeout(async (signal) => {
      const startedAt = Date.now();
      const res = await fetch(`${API_URL}/api/bandwidth/echo`, { cache: 'no-store', signal });
      if (!res.ok) return null;
      const body = await res.arrayBuffer();
      return toMbps(body.byteLength, Date.now() - startedAt);
    });
  }

  private measureUpload(): Promise<number | null> {
    return this.withTimeout(async (signal) => {
      const payload = new Uint8Array(BANDWIDTH_PAYLOAD_BYTES);
      const startedAt = Date.now();
      const res = await fetch(`${API_URL}/api/bandwidth/echo`, {
        method: 'POST',
        body: payload,
        cache: 'no-store',
        signal,
      });
      if (!res.ok) return null;
      return toMbps(BANDWIDTH_PAYLOAD_BYTES, Date.now() - startedAt);
    });
  }

  /**
   * Run one bandwidth probe under an abort signal that fires after
   * BANDWIDTH_TIMEOUT_MS, resolving to null if it times out or fails.
   *
   * The timer is only cleared once `probe` has fully settled, so it covers reading the
   * body as well as getting the response: a server that returns headers and then stalls
   * the stream would hang `arrayBuffer()` just as surely as one that never replies.
   */
  private async withTimeout(probe: (signal: AbortSignal) => Promise<number | null>): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BANDWIDTH_TIMEOUT_MS);
    try {
      return await probe(controller.signal);
    } catch {
      // Timed out, or the network refused us. Either way there is no measurement to report.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getConnectionQuality(): string | null {
    const connection = navigator.connection;
    if (!connection?.effectiveType) return null;
    const validTypes = ['4g', '3g', '2g', 'slow-2g'];
    return validTypes.includes(connection.effectiveType) ? connection.effectiveType : 'unknown';
  }
}

function toMbps(bytes: number, elapsedMs: number): number | null {
  // A sub-millisecond transfer is below the clock's resolution, so the rate is
  // unmeasurable rather than infinite.
  if (elapsedMs <= 0) return null;
  const mbps = (bytes * 8) / (elapsedMs / 1000) / 1_000_000;
  return parseFloat(mbps.toFixed(2));
}

export const browserCollectorService = new BrowserCollectorService();

export function subscribeToMetricsUpdates(): () => void {
  return websocketService.subscribe<{
    metrics: import('@nodescope/shared').MetricsDto;
    sourceTypes: string[];
  }>(WS_EVENTS.METRICS_UPDATE, (data) => {
    useRealtimeStore.getState().setMetrics(data.metrics, data.sourceTypes);
  });
}
