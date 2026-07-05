import { AlertDedupService } from '../alert-dedup.service';

const rule = (over = {}) => ({ id: 'r1', cooldownSeconds: 300, ...over }) as never;

describe('AlertDedupService', () => {
  const now = new Date('2026-01-01T00:10:00Z');
  function svc(latest: { kind: string; createdAt: Date } | null) {
    const repo = { latestEventFor: jest.fn().mockResolvedValue(latest) } as never;
    return new AlertDedupService(repo);
  }

  it('fires when there is no prior event', async () => {
    expect(await svc(null).shouldFire('o', rule(), 'd', now)).toBe(true);
  });
  it('does NOT fire while an alert is already open (last event FIRING)', async () => {
    expect(await svc({ kind: 'FIRING', createdAt: new Date('2026-01-01T00:00:00Z') }).shouldFire('o', rule(), 'd', now)).toBe(false);
  });
  it('does NOT re-fire within cooldown after a RESOLVED', async () => {
    // resolved 1 min ago, cooldown 300s → suppressed
    expect(await svc({ kind: 'RESOLVED', createdAt: new Date('2026-01-01T00:09:00Z') }).shouldFire('o', rule(), 'd', now)).toBe(false);
  });
  it('fires again after cooldown elapses', async () => {
    expect(await svc({ kind: 'RESOLVED', createdAt: new Date('2026-01-01T00:00:00Z') }).shouldFire('o', rule(), 'd', now)).toBe(true);
  });
  it('resolves only when an alert is open', async () => {
    expect(await svc({ kind: 'FIRING', createdAt: now }).shouldResolve('o', rule(), 'd')).toBe(true);
    expect(await svc({ kind: 'RESOLVED', createdAt: now }).shouldResolve('o', rule(), 'd')).toBe(false);
    expect(await svc(null).shouldResolve('o', rule(), 'd')).toBe(false);
  });
  it('dedupKey combines rule + device', () => {
    expect(svc(null).dedupKey('r1', 'd1')).toBe('r1:d1');
    expect(svc(null).dedupKey('r1', null)).toBe('r1:-');
  });
});
