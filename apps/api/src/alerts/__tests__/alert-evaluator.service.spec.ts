import { AlertEvaluatorService, scopeCovers } from '../alert-evaluator.service';

const emit = (state: string) => ({
  organizationId: 'o', deviceId: 'd', governingSiteId: 's', state, latencyMs: 5, at: '2026-01-01T00:00:00Z',
});

function harness(rules: unknown[], dedup: { shouldFire?: boolean; shouldResolve?: boolean } = {}) {
  const created: unknown[] = [];
  const enqueued: unknown[] = [];
  const repo = {
    enabledRules: jest.fn().mockResolvedValue(rules),
    createEvent: jest.fn().mockImplementation((e) => { created.push(e); return Promise.resolve({ id: 'e1', ...e }); }),
    enqueueDeliveries: jest.fn().mockImplementation((id, ch) => { enqueued.push({ id, ch }); return Promise.resolve(); }),
    deviceNetworkId: jest.fn().mockResolvedValue('n1'),
  } as never;
  const dedupSvc = {
    dedupKey: (r: string, d: string) => `${r}:${d}`,
    shouldFire: jest.fn().mockResolvedValue(dedup.shouldFire ?? true),
    shouldResolve: jest.fn().mockResolvedValue(dedup.shouldResolve ?? true),
  } as never;
  return { svc: new AlertEvaluatorService(repo, dedupSvc), created, enqueued };
}

const rule = (over = {}) => ({
  id: 'r1', organizationId: 'o', trigger: 'STATE_TRANSITION', scope: { all: true },
  targetStates: ['DOWN'], severity: 'CRITICAL', channelIds: ['c1'], notifyOnRecovery: true, ...over,
});

describe('scopeCovers', () => {
  it('all:true covers anything', () => expect(scopeCovers({ all: true }, { deviceId: 'd', siteId: 's' })).toBe(true));
  it('deviceIds matches the device', () => {
    expect(scopeCovers({ deviceIds: ['d'] }, { deviceId: 'd', siteId: 's' })).toBe(true);
    expect(scopeCovers({ deviceIds: ['x'] }, { deviceId: 'd', siteId: 's' })).toBe(false);
  });
  it('siteIds matches the governing site', () => {
    expect(scopeCovers({ siteIds: ['s'] }, { deviceId: 'd', siteId: 's' })).toBe(true);
  });
});

describe('AlertEvaluatorService.onStatusChange', () => {
  it('FIRES a FIRING event + enqueues deliveries when a device enters a target state', async () => {
    const h = harness([rule()]);
    await h.svc.onStatusChange(emit('DOWN'));
    expect(h.created).toEqual([expect.objectContaining({ kind: 'FIRING', ruleId: 'r1', deviceId: 'd', severity: 'CRITICAL' })]);
    expect(h.enqueued).toEqual([{ id: 'e1', ch: ['c1'] }]);
  });
  it('does not fire when the new state is not a target', async () => {
    const h = harness([rule()]);
    await h.svc.onStatusChange(emit('WARNING'));
    expect(h.created).toEqual([]);
  });
  it('RESOLVES on recovery to UP', async () => {
    const h = harness([rule()]);
    await h.svc.onStatusChange(emit('UP'));
    expect(h.created).toEqual([expect.objectContaining({ kind: 'RESOLVED', ruleId: 'r1' })]);
  });
  it('respects dedup (no fire when shouldFire=false)', async () => {
    const h = harness([rule()], { shouldFire: false });
    await h.svc.onStatusChange(emit('DOWN'));
    expect(h.created).toEqual([]);
  });
  it('fires a networkIds-scoped rule when the device is in that network', async () => {
    const h = harness([rule({ scope: { networkIds: ['n1'] } })]);
    await h.svc.onStatusChange(emit('DOWN'));
    expect(h.created).toEqual([expect.objectContaining({ kind: 'FIRING', ruleId: 'r1' })]);
  });
  it('does NOT fire a networkIds-scoped rule when the device is in a different network', async () => {
    const h = harness([rule({ scope: { networkIds: ['other'] } })]);
    await h.svc.onStatusChange(emit('DOWN'));
    expect(h.created).toEqual([]);
  });
});
