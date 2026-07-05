import { Test } from '@nestjs/testing';
import { TimescaleMetricReader } from '../timescale-metric-reader';
import { MonitoringRepository } from '../../monitoring/monitoring.repository';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Integration test (real test DB :5433, TimescaleDB). Named `.repository.spec.ts` so it runs
 * under jest.integration.config (and is excluded from the unit suite).
 *
 * Locks in TimescaleMetricReader's "sustained breach, not spike" window-aggregate against real
 * SQL: MIN(value) for `op === 'gt'` (every sample must be over the threshold) and MAX(value) for
 * `op === 'lt'` (every sample must be under it). alert-metric-evaluator.service.spec.ts mocks the
 * reader entirely, so this is the only place that exercises the raw query.
 */
describe('TimescaleMetricReader (integration)', () => {
  let reader: TimescaleMetricReader;
  let monitoring: MonitoringRepository;
  let prisma: PrismaService;
  let orgId: string;
  let deviceA: string;
  let deviceB: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [TimescaleMetricReader, MonitoringRepository, PrismaService],
    }).compile();
    reader = ref.get(TimescaleMetricReader);
    monitoring = ref.get(MonitoringRepository);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: `TMR${Date.now()}${Math.floor(performance.now())}` },
    });
    orgId = org.id;
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'N' } });
    const site = await prisma.property.create({
      data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'S' },
    });
    const a = await prisma.device.create({
      data: { organizationId: orgId, name: 'A', category: 'SWITCH', propertyId: site.id, networkId: net.id },
    });
    const b = await prisma.device.create({
      data: { organizationId: orgId, name: 'B', category: 'SWITCH', propertyId: site.id, networkId: net.id },
    });
    deviceA = a.id;
    deviceB = b.id;

    const now = Date.now();
    // Device A: a single spike among otherwise-fine samples (40, 40, 500) — a real prober would
    // see one bad reading, not a sustained problem.
    // Device B: sustained-high — every sample already over a 100ms threshold (150, 160, 155).
    await monitoring.insertMetrics([
      { organizationId: orgId, deviceId: deviceA, metric: 'latency_ms', value: 40, source: 'prober', ts: new Date(now - 30_000) },
      { organizationId: orgId, deviceId: deviceA, metric: 'latency_ms', value: 40, source: 'prober', ts: new Date(now - 20_000) },
      { organizationId: orgId, deviceId: deviceA, metric: 'latency_ms', value: 500, source: 'prober', ts: new Date(now - 10_000) },
      { organizationId: orgId, deviceId: deviceB, metric: 'latency_ms', value: 150, source: 'prober', ts: new Date(now - 30_000) },
      { organizationId: orgId, deviceId: deviceB, metric: 'latency_ms', value: 160, source: 'prober', ts: new Date(now - 20_000) },
      { organizationId: orgId, deviceId: deviceB, metric: 'latency_ms', value: 155, source: 'prober', ts: new Date(now - 10_000) },
    ]);
  });

  afterEach(async () => {
    // MonitoringMetric is a raw-SQL Timescale hypertable (no Prisma model, no FK to
    // Organization/Device — see monitoring.repository.ts), so it is NOT cascade-deleted when the
    // org is removed. Clean it up explicitly to avoid leaking rows across test runs.
    await prisma.$executeRaw`DELETE FROM "MonitoringMetric" WHERE "organizationId" = ${orgId}`;
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it('op=gt returns MIN(value) per device: a spike does not breach, sustained-high does', async () => {
    const rows = await reader.sustainedLatencyOverWindow(orgId, [deviceA, deviceB], 300, 'gt');
    const byDevice = Object.fromEntries(rows.map((r) => [r.deviceId, Number(r.value)]));

    expect(byDevice[deviceA]).toBe(40);
    expect(byDevice[deviceB]).toBe(150);

    // threshold = 100: device A's single 500ms spike is invisible to the sustained aggregate (its
    // MIN is 40, under threshold — no breach); device B's MIN is 150 — every sample breached, so
    // the sustained rule DOES fire.
    expect(byDevice[deviceA] > 100).toBe(false);
    expect(byDevice[deviceB] > 100).toBe(true);
  });

  it('op=lt returns MAX(value) per device', async () => {
    const rows = await reader.sustainedLatencyOverWindow(orgId, [deviceA, deviceB], 300, 'lt');
    const byDevice = Object.fromEntries(rows.map((r) => [r.deviceId, Number(r.value)]));

    expect(byDevice[deviceA]).toBe(500);
    expect(byDevice[deviceB]).toBe(160);
  });
});
