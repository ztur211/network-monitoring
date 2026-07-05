import { AlertDeliveryService, backoffMs } from '../alert-delivery.service';

function harness(dispatchImpl: () => Promise<void>, delivery: Record<string, unknown>) {
  const marks: unknown[] = [];
  const repo = {
    dueDeliveries: jest.fn().mockResolvedValue([{ id: 'del1', channelId: 'c1', attempts: (delivery.attempts as number) ?? 0, event: { id: 'e1' } }]),
    channelsByIds: jest.fn().mockResolvedValue([{ id: 'c1', type: 'WEBHOOK', name: 'w', enabled: true, config: {}, secretEnc: null }]),
    markDelivery: jest.fn().mockImplementation((id, patch) => { marks.push({ id, patch }); return Promise.resolve(); }),
  } as never;
  const dispatcher = { dispatch: jest.fn().mockImplementation(dispatchImpl) } as never;
  const redis = { set: jest.fn().mockResolvedValue('OK') } as never;
  return { svc: new AlertDeliveryService(repo, dispatcher, redis), marks };
}

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
