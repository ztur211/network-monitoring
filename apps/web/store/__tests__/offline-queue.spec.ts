/**
 * Unit tests for the offline-replay machinery: persistence, conflict
 * classification, and the bounded-retry drain loop.
 *
 * The load-bearing invariants:
 *  - the queue is persisted so offline edits survive a reload;
 *  - the queue is cleared BEFORE replaying, and only ops that still need work
 *    are written back;
 *  - a transient failure requeues with attempts+1 up to the cap, then gives up;
 *  - a 409 conflict gives up immediately (never loops on a stale baseVersion).
 */
import {
  drainOfflineQueue,
  isConflictError,
  loadPersistedQueue,
  persistQueue,
  MAX_REPLAY_ATTEMPTS,
  type GiveUpReason,
} from '../offline-queue';

interface Op {
  id: number;
  attempts: number;
}

function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('persistence', () => {
  const KEY = 'ns:offlineQueue:test';

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('returns [] when storage is unavailable', () => {
    expect(loadPersistedQueue<Op>(KEY)).toEqual([]);
  });

  it('round-trips a queue through storage', () => {
    (globalThis as { localStorage?: Storage }).localStorage = makeFakeStorage();
    const ops: Op[] = [{ id: 1, attempts: 0 }, { id: 2, attempts: 2 }];

    persistQueue(KEY, ops);
    expect(loadPersistedQueue<Op>(KEY)).toEqual(ops);
  });

  it('removes the key when persisting an empty queue', () => {
    const storage = makeFakeStorage();
    (globalThis as { localStorage?: Storage }).localStorage = storage;

    persistQueue(KEY, [{ id: 1, attempts: 0 }]);
    expect(storage.getItem(KEY)).not.toBeNull();

    persistQueue(KEY, []);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('returns [] for corrupt stored JSON', () => {
    const storage = makeFakeStorage();
    storage.setItem(KEY, '{not json');
    (globalThis as { localStorage?: Storage }).localStorage = storage;

    expect(loadPersistedQueue<Op>(KEY)).toEqual([]);
  });
});

describe('isConflictError', () => {
  it('is true for an HTTP 409 error', () => {
    expect(isConflictError({ response: { status: 409 } })).toBe(true);
  });

  it('is false for other statuses and for non-HTTP errors', () => {
    expect(isConflictError({ response: { status: 500 } })).toBe(false);
    expect(isConflictError(new Error('offline'))).toBe(false);
    expect(isConflictError(undefined)).toBe(false);
    expect(isConflictError(null)).toBe(false);
  });
});

describe('drainOfflineQueue', () => {
  it('is a no-op when the queue is empty (no clear, no replay)', async () => {
    const setQueue = jest.fn();
    const replay = jest.fn();
    const onGiveUp = jest.fn();

    await drainOfflineQueue<Op>(() => [], setQueue, replay, onGiveUp);

    expect(setQueue).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('clears the queue before replaying any op', async () => {
    const order: string[] = [];
    await drainOfflineQueue<Op>(
      () => [{ id: 1, attempts: 0 }],
      () => order.push('clear'),
      async () => void order.push('replay'),
      () => {},
    );
    expect(order[0]).toBe('clear');
    expect(order).toContain('replay');
  });

  it('replays every op in queue order and leaves the queue empty on full success', async () => {
    const seen: number[] = [];
    let queue: Op[] = [{ id: 1, attempts: 0 }, { id: 2, attempts: 0 }, { id: 3, attempts: 0 }];

    await drainOfflineQueue<Op>(
      () => queue,
      (ops) => {
        queue = ops;
      },
      async (op) => void seen.push(op.id),
      () => {},
    );

    expect(seen).toEqual([1, 2, 3]);
    expect(queue).toEqual([]);
  });

  it('requeues a transiently-failing op with attempts+1 (under the cap)', async () => {
    let queue: Op[] = [{ id: 1, attempts: 0 }];
    const onGiveUp = jest.fn();

    await drainOfflineQueue<Op>(
      () => queue,
      (ops) => {
        queue = ops;
      },
      async () => {
        throw new Error('still offline');
      },
      onGiveUp,
    );

    expect(queue).toEqual([{ id: 1, attempts: 1 }]);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('gives up immediately on a 409 conflict and does NOT requeue', async () => {
    let queue: Op[] = [{ id: 1, attempts: 0 }];
    const reasons: GiveUpReason[] = [];

    await drainOfflineQueue<Op>(
      () => queue,
      (ops) => {
        queue = ops;
      },
      async () => {
        throw { response: { status: 409 } };
      },
      (_op, reason) => reasons.push(reason),
    );

    expect(queue).toEqual([]);
    expect(reasons).toEqual(['conflict']);
  });

  it('gives up (no requeue) once an op reaches the retry cap', async () => {
    let queue: Op[] = [{ id: 1, attempts: MAX_REPLAY_ATTEMPTS - 1 }];
    const reasons: GiveUpReason[] = [];

    await drainOfflineQueue<Op>(
      () => queue,
      (ops) => {
        queue = ops;
      },
      async () => {
        throw new Error('still offline');
      },
      (_op, reason) => reasons.push(reason),
    );

    expect(queue).toEqual([]);
    expect(reasons).toEqual(['exhausted']);
  });

  it('reads the queue snapshot once, up front', async () => {
    const getQueue = jest.fn(() => [] as Op[]);
    await drainOfflineQueue<Op>(getQueue, () => {}, async () => {}, () => {});
    expect(getQueue).toHaveBeenCalledTimes(1);
  });
});
