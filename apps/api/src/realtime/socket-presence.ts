export const REDIS_KEY_SOCKET_PRESENCE = 'nodescope:presence:sockets';

export interface SocketPresence {
  userId: string;
  organizationId: string | null;
  expiresAt: number;
}

export interface LiveSocketPresence extends SocketPresence {
  socketId: string;
}

export function encodeSocketPresence(presence: SocketPresence): string {
  return JSON.stringify(presence);
}

export function decodeSocketPresence(value: string, now = Date.now()): SocketPresence | null {
  try {
    const parsed = JSON.parse(value) as Partial<SocketPresence> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.userId !== 'string' || parsed.userId.length === 0) return null;
    if (
      parsed.organizationId !== null &&
      (typeof parsed.organizationId !== 'string' || parsed.organizationId.length === 0)
    ) return null;
    if (typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt)) return null;
    if (parsed.expiresAt <= now) return null;
    return {
      userId: parsed.userId,
      organizationId: parsed.organizationId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function partitionSocketPresence(
  fields: Record<string, string>,
  now = Date.now(),
): { live: LiveSocketPresence[]; staleEntries: Array<[field: string, observedValue: string]> } {
  const live: LiveSocketPresence[] = [];
  const staleEntries: Array<[string, string]> = [];
  for (const [socketId, value] of Object.entries(fields)) {
    const presence = decodeSocketPresence(value, now);
    if (presence) live.push({ socketId, ...presence });
    else staleEntries.push([socketId, value]);
  }
  return { live, staleEntries };
}
