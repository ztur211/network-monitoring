import { HttpException } from '@nestjs/common';
import { MonitoringService } from '../status/monitoring.service';
import type { OrgMemberContext } from '../../organizations/org-context.types';

/**
 * Unit tests for MonitoringService.getDeviceMetricNames and getDeviceStatusEvents.
 * All deps are mocked — no real DB. Naming: `.spec.ts` so it runs under jest.unit.config.
 * We verify:
 *   1. assertDeviceVisible is called BEFORE the repo (out-of-scope MEMBER → 404).
 *   2. Happy-path: repo methods called with correct args, data flows through.
 *   3. limit capping: [1, 200] bounds enforced.
 */

const ownerMember: OrgMemberContext = { id: 'u1', organizationId: 'org1', role: 'OWNER' };
const memberMember: OrgMemberContext = { id: 'u2', organizationId: 'org1', role: 'MEMBER' };

// Minimal prisma mock so assertDeviceVisible can find/not-find a device
const makePrisma = (propertyId: string | null) => ({
  device: {
    findFirst: jest.fn().mockResolvedValue(propertyId ? { propertyId } : null),
  },
});

// Minimal permissions mock
const makePermissions = (inScopeResult: boolean) => ({
  inScope: jest.fn().mockResolvedValue(inScopeResult),
});

// Minimal devices mock (not needed for these two methods but required by DI)
const devicesStub = { listDevicesForBuilding: jest.fn() };

const makeRepo = () => ({
  metricNames: jest.fn().mockResolvedValue(['latency_ms', 'cpu']),
  recentStatusEvents: jest.fn().mockResolvedValue([
    { time: new Date('2024-01-01T00:00:00Z'), state: 'UP', source: 'prober' },
    { time: new Date('2024-01-01T00:01:00Z'), state: 'DOWN', source: 'prober' },
  ]),
  queryMetric: jest.fn(),
  listStatus: jest.fn(),
  upsertStatus: jest.fn(),
  insertMetric: jest.fn(),
  insertStatusEvent: jest.fn(),
  insertMetrics: jest.fn(),
  insertStatusEvents: jest.fn(),
  getStatus: jest.fn(),
});

/**
 * Build a MonitoringService with injected mocks directly (no Test module needed
 * for this pure-unit test; the constructor accepts typed deps).
 */
function buildService(
  prismaDevice: { propertyId: string } | null,
  inScope: boolean,
  repo: ReturnType<typeof makeRepo>,
): MonitoringService {
  const prisma = makePrisma(prismaDevice?.propertyId ?? null);
  const permissions = makePermissions(inScope);
  // MonitoringService constructor: prisma, devices, repo, permissions
  return new MonitoringService(prisma as any, devicesStub as any, repo as any, permissions as any);
}

describe('MonitoringService.getDeviceMetricNames', () => {
  it('OWNER: calls repo.metricNames and returns the name list', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, true, repo);
    const result = await svc.getDeviceMetricNames(ownerMember, 'dev1');
    expect(result).toEqual(['latency_ms', 'cpu']);
    expect(repo.metricNames).toHaveBeenCalledWith('org1', 'dev1', expect.any(Date));
    // the since date should be ~24h ago
    const sinceArg: Date = repo.metricNames.mock.calls[0][2];
    expect(Date.now() - sinceArg.getTime()).toBeCloseTo(24 * 3600_000, -4); // within 10s
  });

  it('device not found → 404 before repo is called', async () => {
    const repo = makeRepo();
    const svc = buildService(null, false, repo);
    await expect(svc.getDeviceMetricNames(ownerMember, 'missing')).rejects.toBeInstanceOf(HttpException);
    await expect(svc.getDeviceMetricNames(ownerMember, 'missing')).rejects.toMatchObject({ status: 404 });
    expect(repo.metricNames).not.toHaveBeenCalled();
  });

  it('out-of-scope MEMBER → 404 before repo is called', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, false /* inScope=false */, repo);
    await expect(svc.getDeviceMetricNames(memberMember, 'dev1')).rejects.toMatchObject({ status: 404 });
    expect(repo.metricNames).not.toHaveBeenCalled();
  });

  it('in-scope MEMBER → repo called normally', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, true, repo);
    const result = await svc.getDeviceMetricNames(memberMember, 'dev1');
    expect(result).toEqual(['latency_ms', 'cpu']);
    expect(repo.metricNames).toHaveBeenCalledTimes(1);
  });
});

describe('MonitoringService.getDeviceStatusEvents', () => {
  it('OWNER: calls repo.recentStatusEvents with capped limit and maps to ISO', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, true, repo);
    const result = await svc.getDeviceStatusEvents(ownerMember, 'dev1', 10);
    expect(repo.recentStatusEvents).toHaveBeenCalledWith('org1', 'dev1', 10);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ time: '2024-01-01T00:00:00.000Z', state: 'UP', source: 'prober' });
    expect(result[1]).toMatchObject({ time: '2024-01-01T00:01:00.000Z', state: 'DOWN', source: 'prober' });
  });

  it('limit=0 falls back to default 50 (0 is falsy in "limit || 50")', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, true, repo);
    await svc.getDeviceStatusEvents(ownerMember, 'dev1', 0);
    // 0 || 50 = 50 → Math.max(1,50) = 50 → Math.min(50,200) = 50
    expect(repo.recentStatusEvents).toHaveBeenCalledWith('org1', 'dev1', 50);
  });

  it('limit=999 is clamped to 200', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, true, repo);
    await svc.getDeviceStatusEvents(ownerMember, 'dev1', 999);
    expect(repo.recentStatusEvents).toHaveBeenCalledWith('org1', 'dev1', 200);
  });

  it('undefined limit defaults to 50', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, true, repo);
    await svc.getDeviceStatusEvents(ownerMember, 'dev1', undefined as any);
    expect(repo.recentStatusEvents).toHaveBeenCalledWith('org1', 'dev1', 50);
  });

  it('device not found → 404 before repo is called', async () => {
    const repo = makeRepo();
    const svc = buildService(null, false, repo);
    await expect(svc.getDeviceStatusEvents(ownerMember, 'missing', 10)).rejects.toMatchObject({ status: 404 });
    expect(repo.recentStatusEvents).not.toHaveBeenCalled();
  });

  it('out-of-scope MEMBER → 404 before repo is called', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, false, repo);
    await expect(svc.getDeviceStatusEvents(memberMember, 'dev1', 10)).rejects.toMatchObject({ status: 404 });
    expect(repo.recentStatusEvents).not.toHaveBeenCalled();
  });

  it('in-scope MEMBER → repo called normally', async () => {
    const repo = makeRepo();
    const svc = buildService({ propertyId: 'prop1' }, true, repo);
    const result = await svc.getDeviceStatusEvents(memberMember, 'dev1', 5);
    expect(result).toHaveLength(2);
    expect(repo.recentStatusEvents).toHaveBeenCalledTimes(1);
  });
});
