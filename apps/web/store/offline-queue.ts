/**
 * Shared offline-replay skeleton for the entity stores (device, circuits).
 *
 * Both stores enqueue failed create/update/delete mutations and replay them
 * when connectivity returns. Their drain loops were byte-identical; this
 * extracts the loop plus its load-bearing invariant: the queue is cleared
 * BEFORE replaying, so an op that fails again re-enqueues itself (via its
 * own CRUD method's catch block) instead of being dropped.
 *
 * The per-op replay logic stays in each store (the bound CRUD method names
 * and op shapes differ between stores) and is passed in as `replay`.
 */
export async function drainOfflineQueue<TOp>(
  getQueue: () => TOp[],
  clearQueue: () => void,
  replay: (op: TOp) => Promise<unknown>,
): Promise<void> {
  const ops = getQueue();
  if (ops.length === 0) return;
  clearQueue();
  for (const op of ops) {
    try {
      await replay(op);
    } catch {
      // The failed op re-queued itself via its CRUD method's catch block.
    }
  }
}
