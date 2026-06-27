import { AccountTier, ConnectionStatus } from '@nodescope/shared';

export const REALTIME_SERVICE = Symbol('REALTIME_SERVICE');

export const REDIS_KEY_CONNECTIONS = (userId: string) => `nodescope:connections:${userId}`;
export const REDIS_KEY_PUSH_SCHEDULER_LOCK = 'nodescope:lock:push_scheduler';
// userId -> orgId for users with at least one live socket. Lets the 30s metrics push enumerate
// connected (user, org) pairs from one Redis read instead of fetchSockets() serializing every
// socket's full data cluster-wide. A crashed node can leave a stale entry — benign: it only
// triggers a no-op push to a user-room with no sockets, and self-heals on the user's reconnect.
export const REDIS_KEY_CONN_ORG = 'nodescope:conn:userorg';

export interface IRealtimeService {
  pushToUser(userId: string, event: string, payload: unknown): void;
  pushToTier(tier: AccountTier, event: string, payload: unknown): void;
  pushToOrg(orgId: string, event: string, payload: unknown): void;
  getConnectionStatus(userId: string): Promise<ConnectionStatus>;
  recomputeOnHomeForUser(userId: string): Promise<void>;
  emitScoped(orgId: string, governingSiteId: string, event: string, payload: unknown): Promise<void>;
  emitScopedMulti(orgId: string, governingSiteIds: string[], event: string, payload: unknown): Promise<void>;
  notifyAccessChanged(orgId: string, userId: string): void;
  /**
   * Force-disconnect every live socket a user holds for the given org, so a member
   * removed from the org cannot keep receiving its `org:`/`scope:` broadcasts or keep
   * ingesting metrics under the now-stale `socket.data.orgId`. Disconnect (not a
   * room-leave) is used deliberately: it is the only primitive that propagates across
   * Redis-adapter nodes AND forces the socket to re-resolve its membership on reconnect.
   */
  evictOrgMember(orgId: string, userId: string): Promise<void>;
}
