import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditStore {
  requestId: string;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export const auditAls = new AsyncLocalStorage<AuditStore>();
