import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringRepository } from '../monitoring.repository';

/**
 * Integration test (real test DB :5433, TimescaleDB). Named `.repository.spec.ts`
 * so it runs under jest.integration.config (and is excluded from the unit suite).
 */
describe('MonitoringRepository (integration)', () => {
  let repo: MonitoringRepository;
  let prisma: PrismaService;
  let orgId: string;
  let deviceId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [MonitoringRepository, PrismaService],
    }).compile();
    repo = ref.get(MonitoringRepository);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `M${Date.now()}${Math.floor(performance.now())}` } });
    orgId = org.id;
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'N' } });
    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' },
    });
    const dev = await prisma.device.create({
      data: {
        organizationId: orgId,
        name: 'D',
        category: 'SWITCH',
        propertyId: site.id,
        networkId: net.id,
        ipAddress: '10.0.0.1',
      },
    });
    deviceId = dev.id;
  });
  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('upserts status, inserts a metric + status event, reads back + buckets', async () => {
    await repo.upsertStatus({
      organizationId: orgId,
      deviceId,
      state: 'UP',
      latencyMs: 12,
      consecutiveFails: 0,
      source: 'prober',
      ok: true,
    });
    await repo.insertMetric({ organizationId: orgId, deviceId, metric: 'latency_ms', value: 12, source: 'prober' });
    await repo.insertStatusEvent({ organizationId: orgId, deviceId, state: 'UP', source: 'prober' });

    const s = await repo.getStatus(orgId, deviceId);
    expect(s?.state).toBe('UP');
    expect(s?.latencyMs).toBe(12);
    expect(s?.lastOkAt).toBeTruthy();

    const series = await repo.queryMetric(
      orgId,
      deviceId,
      'latency_ms',
      new Date(Date.now() - 60000),
      new Date(Date.now() + 60000),
      '1 minute',
    );
    expect(series.length).toBeGreaterThan(0);
    expect(Number(series[0].avg)).toBeCloseTo(12, 3);
  });

  it('upsert is idempotent on deviceId (second call updates, not duplicates)', async () => {
    await repo.upsertStatus({ organizationId: orgId, deviceId, state: 'UP', latencyMs: 5, consecutiveFails: 0, source: 'prober', ok: true });
    await repo.upsertStatus({ organizationId: orgId, deviceId, state: 'DOWN', latencyMs: null, consecutiveFails: 3, source: 'prober', ok: false, changed: true });
    const all = await repo.listStatus(orgId, [deviceId]);
    expect(all).toHaveLength(1);
    expect(all[0].state).toBe('DOWN');
    expect(all[0].consecutiveFails).toBe(3);
  });
});
