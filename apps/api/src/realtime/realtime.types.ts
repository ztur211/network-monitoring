import { AccountTier, ConnectionStatus } from '@nodescope/shared';

export const REALTIME_SERVICE = Symbol('REALTIME_SERVICE');

export const REDIS_KEY_CONNECTIONS = (userId: string) => `nodescope:connections:${userId}`;
export const REDIS_KEY_PUSH_SCHEDULER_LOCK = 'nodescope:lock:push_scheduler';

export interface IRealtimeService {
  pushToUser(userId: string, event: string, payload: unknown): void;
  pushToTier(tier: AccountTier, event: string, payload: unknown): void;
  pushToOrg(orgId: string, event: string, payload: unknown): void;
  getConnectionStatus(userId: string): Promise<ConnectionStatus>;
  recomputeOnHomeForUser(userId: string): Promise<void>;
  emitScoped(orgId: string, governingSiteId: string, event: string, payload: unknown): Promise<void>;
  emitScopedMulti(orgId: string, governingSiteIds: string[], event: string, payload: unknown): Promise<void>;
  notifyAccessChanged(orgId: string, userId: string): void;
}
