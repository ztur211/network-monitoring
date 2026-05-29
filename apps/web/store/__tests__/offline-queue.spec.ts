/**
 * Unit tests for drainOfflineQueue — the shared offline-replay skeleton
 * extracted from device.store / circuits.store, which had byte-identical
 * flush loops. The load-bearing invariant is "clear the queue BEFORE
 * replaying", so an op that fails again re-enqueues itself (via its own
 * CRUD method's catch block) instead of being dropped.
 */
import { drainOfflineQueue } from '../offline-queue';

describe('drainOfflineQueue', () => {
  it('is a no-op when the queue is empty (no clear, no replay)', async () => {
    const clearQueue = jest.fn();
    const replay = jest.fn();

    await drainOfflineQueue<{ id: number }>(() => [], clearQueue, replay);

    expect(clearQueue).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it('clears the queue before replaying any op', async () => {
    const order: string[] = [];
    const ops = [{ id: 1 }];

    await drainOfflineQueue(
      () => ops,
      () => order.push('clear'),
      async () => {
        order.push('replay');
      },
    );

    expect(order).toEqual(['clear', 'replay']);
  });

  it('replays every op in queue order', async () => {
    const ops = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const seen: number[] = [];

    await drainOfflineQueue(
      () => ops,
      () => {},
      async (op) => {
        seen.push(op.id);
      },
    );

    expect(seen).toEqual([1, 2, 3]);
  });

  it('continues replaying remaining ops when one rejects, and never throws', async () => {
    const ops = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const seen: number[] = [];
    const replay = jest.fn(async (op: { id: number }) => {
      seen.push(op.id);
      if (op.id === 1) throw new Error('still offline');
    });

    await expect(drainOfflineQueue(() => ops, () => {}, replay)).resolves.toBeUndefined();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('reads the queue snapshot once, up front', async () => {
    const getQueue = jest.fn(() => [{ id: 1 }]);

    await drainOfflineQueue(getQueue, () => {}, async () => {});

    expect(getQueue).toHaveBeenCalledTimes(1);
  });
});
