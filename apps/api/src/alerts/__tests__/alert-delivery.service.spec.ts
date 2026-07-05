import { AlertDeliveryService, backoffMs } from '../alert-delivery.service';

function harness(dispatchImpl: () => Promise<void>, delivery: Record<string, unknown>) {
  const marks: unknown[] = [];
  const repo = {
    dueDeliveries: jest.fn().mockResolvedValue([{ id: 'del1', channelId: 'c1', attempts: (delivery.attempts as number) ?? 0, event: { id: 'e1' } }]),
    channelsByIds: jest.fn().mockResolvedValue([{ id: 'c1', type: 'WEBHOOK', name: 'w', enabled: true, config: {}, secretEnc: null }]),
    markDelivery: jest.fn().mockImplementation((id, patch) => { marks.push({ id, patch }); return Promise.resolve(); }),
  };
  const dispatcher = { dispatch: jest.fn().mockImplementation(dispatchImpl) };
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  return { svc: new AlertDeliveryService(repo as never, dispatcher as never, redis as never), marks, repo, dispatcher, redis };
}

/** Flushes the whole microtask queue (not just one tick) via a macrotask boundary, so any
 *  in-flight promise chain progresses as far as it can before we assert / act further. */
const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('backoffMs', () => {
  it('is exponential and capped', () => {
    expect(backoffMs(0)).toBe(5000);
    expect(backoffMs(3)).toBe(40000);
    expect(backoffMs(50)).toBe(3_600_000); // cap
  });
});

describe('AlertDeliveryService.drainOnce', () => {
  it('marks SENT on success', async () => {
    const h = harness(() => Promise.resolve(), {});
    await h.svc.drainOnce(new Date());
    expect(h.marks).toEqual([{ id: 'del1', patch: expect.objectContaining({ status: 'SENT' }) }]);
  });
  it('marks FAILED with backoff on error (still retryable — notify on recovery)', async () => {
    const h = harness(() => Promise.reject(new Error('WAN down')), { attempts: 1 });
    await h.svc.drainOnce(new Date());
    expect(h.marks[0]).toEqual({ id: 'del1', patch: expect.objectContaining({ status: 'FAILED', attempts: 2, lastError: 'WAN down' }) });
  });
  it('gives up after ALERT_MAX_ATTEMPTS', async () => {
    process.env.ALERT_MAX_ATTEMPTS = '3';
    const h = harness(() => Promise.reject(new Error('x')), { attempts: 3 });
    await h.svc.drainOnce(new Date());
    expect(h.marks[0]).toEqual({ id: 'del1', patch: expect.objectContaining({ status: 'GAVE_UP' }) });
    delete process.env.ALERT_MAX_ATTEMPTS;
  });
});

// I1: the cycle's Redis lock TTL (ALERT_DELIVER_INTERVAL_SECONDS) can expire while a slow
// sequential drainOnce is still running, letting the next setInterval tick re-acquire the lock
// and start a second concurrent drain IN THIS PROCESS — re-dispatching the same rows. The
// `draining` re-entrancy guard on `cycle()` must make that a no-op. `cycle` is private, so the
// test reaches it via a narrow cast — there is no public surface for a "one drain at a time"
// invariant other than the private cycle method itself.
describe('AlertDeliveryService.cycle re-entrancy (I1)', () => {
  it('a second cycle() call while a drain is in flight is a no-op (no duplicate dispatch)', async () => {
    let resolveDispatch!: () => void;
    const pending = new Promise<void>((resolve) => { resolveDispatch = resolve; });
    const h = harness(() => pending, {});
    const cyclable = h.svc as unknown as { cycle(): Promise<void> };

    const first = cyclable.cycle();
    // Let the first cycle acquire the Redis lock, flip `draining = true`, and reach the
    // (hanging) dispatch call before the second cycle starts — mirrors the real timing where
    // setInterval ticks are seconds apart, not synchronous.
    await flushMicrotasks();
    const second = cyclable.cycle();

    resolveDispatch();
    await first;
    await second;

    expect(h.repo.dueDeliveries).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
});
