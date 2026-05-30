/**
 * Shared offline-replay machinery for the entity stores (device, circuits).
 *
 * Both stores enqueue failed create/update/delete mutations and replay them
 * when connectivity returns. This module owns three cross-cutting concerns so
 * the stores stay thin:
 *
 *  1. Persistence — the queue is mirrored to localStorage. It used to live only
 *     in Zustand memory, so a reload or tab close while offline dropped every
 *     queued op silently. Persisting it means offline edits survive a refresh.
 *
 *  2. Bounded retry — each op carries an `attempts` counter. A transient replay
 *     failure (still offline) requeues the op with attempts+1, up to
 *     MAX_REPLAY_ATTEMPTS, then gives up instead of retrying forever.
 *
 *  3. Conflict give-up — a 409 from the server means the row's version moved or
 *     it already exists; replaying the same stale op can never succeed, so we
 *     stop immediately and surface the conflict rather than looping on SYNC_001.
 */

export interface QueuedOp {
  attempts: number;
}

export const MAX_REPLAY_ATTEMPTS = 5;

export type GiveUpReason = 'conflict' | 'exhausted';

function getStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    // Accessing localStorage can throw (e.g. Safari private mode).
    return null;
  }
}

/** Reads a persisted queue. Returns [] when storage is unavailable or invalid. */
export function loadPersistedQueue<TOp>(key: string): TOp[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TOp[]) : [];
  } catch {
    return [];
  }
}

/** Mirrors the queue to storage. Removes the key when the queue is empty. */
export function persistQueue<TOp>(key: string, ops: TOp[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (ops.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(ops));
  } catch {
    // Quota or serialization failure — keep the in-memory queue, drop the mirror.
  }
}

/**
 * True when `err` represents a server-side conflict (HTTP 409): optimistic-
 * concurrency mismatch (SYNC_001) or a uniqueness violation (e.g. DEVICE_003).
 * Replaying the same op will never succeed, so the drain stops rather than
 * looping. Checked structurally so this module doesn't depend on axios.
 */
export function isConflictError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null | undefined)?.response
    ?.status;
  return status === 409;
}

/**
 * Replays every queued op once. The queue is cleared up front; an op that fails
 * transiently is requeued with attempts+1 (until MAX_REPLAY_ATTEMPTS), an op
 * that hits a conflict or exhausts its budget is dropped and reported via
 * `onGiveUp`. `replay` must NOT itself enqueue on failure — this loop owns the
 * requeue decision.
 *
 * `setQueue` both updates store state and persists, so the on-disk mirror stays
 * in lock-step with what still needs replaying.
 */
export async function drainOfflineQueue<TOp extends QueuedOp>(
  getQueue: () => TOp[],
  setQueue: (ops: TOp[]) => void,
  replay: (op: TOp) => Promise<unknown>,
  onGiveUp: (op: TOp, reason: GiveUpReason) => void,
  maxAttempts: number = MAX_REPLAY_ATTEMPTS,
): Promise<void> {
  const ops = getQueue();
  if (ops.length === 0) return;

  // Clear before replaying so the queue reflects only ops that still need work;
  // survivors are appended back below.
  setQueue([]);

  const survivors: TOp[] = [];
  for (const op of ops) {
    try {
      await replay(op);
    } catch (err) {
      const nextAttempts = (op.attempts ?? 0) + 1;
      if (isConflictError(err)) {
        onGiveUp(op, 'conflict');
      } else if (nextAttempts >= maxAttempts) {
        onGiveUp(op, 'exhausted');
      } else {
        survivors.push({ ...op, attempts: nextAttempts });
      }
    }
  }

  if (survivors.length > 0) {
    // Append after any ops a concurrent user action enqueued during replay.
    setQueue([...getQueue(), ...survivors]);
  }
}
