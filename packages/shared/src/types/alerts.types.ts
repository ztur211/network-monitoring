export type AlertChannelType = 'WEBHOOK' | 'EMAIL' | 'INAPP';
export type AlertTrigger = 'STATE_TRANSITION' | 'METRIC_THRESHOLD';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertEventKind = 'FIRING' | 'RESOLVED';

/** Channel as returned by the API — secretEnc is NEVER included (redacted view). */
export interface AlertChannelDto {
  id: string; organizationId: string; type: AlertChannelType; name: string;
  enabled: boolean; config: Record<string, unknown>; version: number;
  createdAt: string; updatedAt: string;
}
export interface CreateAlertChannelDto {
  type: AlertChannelType; name: string; enabled?: boolean;
  config?: Record<string, unknown>; secret?: string;
}
export interface AlertRuleDto {
  id: string; organizationId: string; name: string; enabled: boolean;
  trigger: AlertTrigger; scope: Record<string, unknown>; targetStates: string[];
  metric: string | null; op: string | null; threshold: number | null; forSeconds: number | null;
  severity: AlertSeverity; channelIds: string[]; cooldownSeconds: number;
  notifyOnRecovery: boolean; version: number; createdAt: string; updatedAt: string;
}
export interface CreateAlertRuleDto {
  name: string; trigger: AlertTrigger; scope: Record<string, unknown>;
  targetStates?: string[]; metric?: string; op?: 'gt' | 'lt'; threshold?: number; forSeconds?: number;
  severity: AlertSeverity; channelIds: string[]; cooldownSeconds: number; notifyOnRecovery: boolean;
}
export interface AlertEventDto {
  id: string; organizationId: string; ruleId: string; deviceId: string | null;
  kind: AlertEventKind; severity: AlertSeverity; detail: Record<string, unknown>;
  dedupKey: string; createdAt: string;
}
/** Realtime v1:alert:* payload (from InAppChannel.send). */
export interface AlertRealtimePayload {
  id: string; ruleId: string; deviceId: string | null; severity: AlertSeverity;
  detail: Record<string, unknown>; at: string;
}
