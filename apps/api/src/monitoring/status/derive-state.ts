import { DeviceStatusState } from '@prisma/client';

export interface DeriveConfig {
  downThreshold: number;
  warnLatencyMs: number;
}
export interface DeriveInput {
  ok: boolean;
  latencyMs?: number;
}
export interface DerivePrev {
  consecutiveFails: number;
}
export interface DeriveResult {
  state: DeviceStatusState;
  consecutiveFails: number;
}

/**
 * Pure per-check state derivation (spec §7). UNKNOWN is set by the caller when a
 * device has no ipAddress or its last check is stale; deriveState covers checked
 * devices only.
 *
 * Anti-flap: a single failed check below `downThreshold` is a soft WARNING rather
 * than a hard DOWN, so one dropped packet does not flap the node.
 */
export function deriveState(prev: DerivePrev, check: DeriveInput, cfg: DeriveConfig): DeriveResult {
  if (check.ok) {
    const slow = (check.latencyMs ?? 0) > cfg.warnLatencyMs;
    return { state: slow ? 'WARNING' : 'UP', consecutiveFails: 0 };
  }
  const consecutiveFails = prev.consecutiveFails + 1;
  return {
    state: consecutiveFails >= cfg.downThreshold ? 'DOWN' : 'WARNING',
    consecutiveFails,
  };
}
