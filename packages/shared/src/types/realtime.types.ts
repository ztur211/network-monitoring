export const WS_EVENTS = {
  // Client → Server
  METRICS_SUBMIT: 'v1:metrics:submit',
  AI_MESSAGE: 'v1:ai:message',
  PING: 'v1:ping',

  // Server → Client
  METRICS_UPDATE: 'v1:metrics:update',
  DEVICE_UPDATED: 'v1:device:updated',
  DEVICE_DELETED: 'v1:device:deleted',
  CIRCUIT_UPDATED: 'v1:circuit:updated',
  CIRCUIT_DELETED: 'v1:circuit:deleted',
  FIBER_RUN_UPDATED: 'v1:fiber-run:updated',
  FIBER_RUN_DELETED: 'v1:fiber-run:deleted',
  CONNECTION_UPDATED: 'v1:connection:updated',
  CONNECTION_DELETED: 'v1:connection:deleted',
  AI_TOKEN: 'v1:ai:token',
  AI_COMPLETE: 'v1:ai:complete',
  CONNECTION_STATUS: 'v1:connection:status',
  ERROR: 'v1:error',
  PONG: 'v1:pong',
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export interface MetricsDto {
  bandwidthDown: number | null;
  bandwidthUp: number | null;
  latency: number | null;
  connectionQuality: string | null;
  timestamp: string;
}
