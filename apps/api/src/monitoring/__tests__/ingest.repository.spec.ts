import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringRepository } from '../monitoring.repository';
import { IngestService, MONITORING_EMITTER } from '../ingest/ingest.service';

/**
 * Integration test (real test DB :5433). Named `.repository.spec.ts` so it runs under
 * jest.integration.config (the DB-integration bucket) rather than the unit suite.
 */
describe('IngestService (integration)', () => {
  let svc: IngestService;
  let prisma: PrismaService;
  let orgId: string;
  let deviceId: string;
  const emit = jest.fn();

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [
        IngestService,
        MonitoringRepository,
        PrismaService,
        { provide: MONITORING_EMITTER, useValue: { emitDeviceStatus: emit } },
      ],
    }).compile();
    svc = ref.get(IngestService);
    prisma = ref.get(PrismaService);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: `I${Date.now()}${Math.floor(performance.now())}` } });
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

  it('first ok check → UP + emits once; a second ok check does not re-emit', async () => {
    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: true, latencyMs: 10, source: 'prober' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ deviceId, state: 'UP' });

    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: true, latencyMs: 11, source: 'prober' });
    expect(emit).toHaveBeenCalledTimes(1); // no transition → no re-emit
  });

  it('emits the governing site id (device.propertyId) for F3 scoping', async () => {
    const dev = await prisma.device.findUniqueOrThrow({ where: { id: deviceId }, select: { propertyId: true } });
    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: true, latencyMs: 5, source: 'prober' });
    expect(emit.mock.calls[0][0]).toMatchObject({ governingSiteId: dev.propertyId });
  });

  it('transitions UP → DOWN after the failure threshold, emitting on the change', async () => {
    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: true, latencyMs: 5, source: 'prober' }); // UP (emit 1)
    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: false, source: 'prober' }); // soft WARNING (emit 2)
    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: false, source: 'prober' }); // still WARNING (no emit)
    await svc.reportStatusCheck({ organizationId: orgId, deviceId, ok: false, source: 'prober' }); // DOWN (emit 3)
    const states = emit.mock.calls.map((c) => c[0].state);
    expect(states).toEqual(['UP', 'WARNING', 'DOWN']);
  });

  it('reportMetric inserts a generic metric row', async () => {
    await svc.reportMetric({ organizationId: orgId, deviceId, metric: 'cpu', value: 42, source: 'agent:1' });
    const series = await new MonitoringRepository(prisma).queryMetric(
      orgId,
      deviceId,
      'cpu',
      new Date(Date.now() - 60000),
      new Date(Date.now() + 60000),
      '1 minute',
    );
    expect(series.length).toBe(1);
    expect(Number(series[0].avg)).toBe(42);
  });

  it('rejects a device from another org (ORG_008)', async () => {
    const other = await prisma.organization.create({ data: { name: `X${Date.now()}${Math.floor(performance.now())}` } });
    await expect(
      svc.reportStatusCheck({ organizationId: other.id, deviceId, ok: true, latencyMs: 5, source: 'x' }),
    ).rejects.toMatchObject({ code: 'ORG_008' });
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
