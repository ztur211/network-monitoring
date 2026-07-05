import { io } from 'socket.io-client';
import { WS_EVENTS } from '@nodescope/shared';
import { createRealtimeClient } from '@nodescope/client';
import { useUiStore } from '../store/ui.store';
import { resolveApiBaseUrl } from './api-base';

const API_URL = resolveApiBaseUrl();
const PING_INTERVAL_MS = 25_000;
const OFFLINE_RETRY_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Web binding for the shared realtime client (@nodescope/client). The socket lifecycle — subscriber
 * registry, Manager-vs-Socket routing, reconnect re-attach, dedup, ping, offline retry — lives in the
 * shared core (and is covered by both packages). Here we supply only the web-specific config: cookie
 * auth, the websocket+polling transports a browser needs, capped reconnection, and the bindings that
 * push connection status / latency into the UI store.
 *
 * `io` is imported here and injected so the existing jest mock of `socket.io-client` still intercepts
 * the socket the core creates (the mock can't reach into the built @nodescope/client otherwise).
 */
export const websocketService = createRealtimeClient({
  baseUrl: API_URL,
  io,
  withCredentials: true,
  transports: ['websocket', 'polling'],
  reconnection: { attempts: MAX_RECONNECT_ATTEMPTS },
  offlineRetryMs: OFFLINE_RETRY_DELAY_MS,
  onStatus: (status) => useUiStore.getState().setConnectionStatus(status),
  ping: {
    event: WS_EVENTS.PING,
    pongEvent: WS_EVENTS.PONG,
    intervalMs: PING_INTERVAL_MS,
    onLatency: (ms) => useUiStore.getState().setLatency(ms),
  },
});
