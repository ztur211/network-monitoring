import { AlertMetricEvaluatorService, breaches } from '../alert-metric-evaluator.service';

const rule = (over = {}) => ({
  id: 'r1', organizationId: 'o', trigger: 'METRIC_THRESHOLD', scope: { all: true },
  metric: 'latencyMs', op: 'gt', threshold: 100, forSeconds: 60, severity: 'WARNING',
  channelIds: ['c1'], notifyOnRecovery: true, ...over,
});

function harness(rows: Array<{ deviceId: string; value: number | null }>, dedup = { shouldFire: true, shouldResolve: true }) {
  const created: unknown[] = [];
  const repo = {
    allEnabledRules: jest.fn().mockResolvedValue([rule()]),
    createEvent: jest.fn().mockImplementation((e) => { created.push(e); return Promise.resolve({ id: 'e1' }); }),
    enqueueDeliveries: jest.fn().mockResolvedValue(undefined),
  } as never;
  const dedupSvc = {
    dedupKey: () => 'k',
    shouldFire: jest.fn().mockResolvedValue(dedup.shouldFire),
    shouldResolve: jest.fn().mockResolvedValue(dedup.shouldResolve),
  } as never;
  const reader = { maxLatencyOverWindow: jest.fn().mockResolvedValue(rows) } as never;
  const redis = { set: jest.fn().mockResolvedValue('OK') } as never;
  return { svc: new AlertMetricEvaluatorService(repo, dedupSvc, reader, redis), created };
}

describe('breaches', () => {
  it('gt/lt', () => {
    expect(breaches('gt', 150, 100)).toBe(true);
    expect(breaches('gt', 50, 100)).toBe(false);
    expect(breaches('lt', 50, 100)).toBe(true);
    expect(breaches('gt', null, 100)).toBe(false); // no data ≠ breach
  });
});

describe('AlertMetricEvaluatorService.evaluateOnce', () => {
  it('FIRES for a device whose windowed latency breaches', async () => {
    const h = harness([{ deviceId: 'd', value: 200 }]);
    await h.svc.evaluateOnce(new Date());
    expect(h.created).toEqual([expect.objectContaining({ kind: 'FIRING', ruleId: 'r1', deviceId: 'd' })]);
  });
  it('RESOLVES for a device back under threshold', async () => {
    const h = harness([{ deviceId: 'd', value: 20 }]);
    await h.svc.evaluateOnce(new Date());
    expect(h.created).toEqual([expect.objectContaining({ kind: 'RESOLVED', deviceId: 'd' })]);
  });
});
