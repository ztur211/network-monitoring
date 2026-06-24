import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E for the Spec 7 + Spec A read APIs (device-status, metrics, status-events, metric-names), F3-scoped.
 * Requires the test DB stack (:5433 / :6380 / :9100). Run: npm run test:e2e -- monitoring.controller
 */
describe('MonitoringController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  let memberCookie: string;
  let orgId: string;
  let buildingId: string; // in scope for the member
  let outOfScopeBuildingId: string;
  let placedDeviceId: string;
  let unstatusedDeviceId: string;
  let outOfScopeDeviceId: string;
  const ownerEmail = `e2e-mon-owner-${Date.now()}@example.com`;
  const memberEmail = `e2e-mon-member-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const signUp = async (email: string, name: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'Password123!', name });
      const c = res.headers['set-cookie'];
      return Array.isArray(c) ? c[0] : c;
    };
    ownerCookie = await signUp(ownerEmail, 'Mon Owner');
    memberCookie = await signUp(memberEmail, 'Mon Member');

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Mon ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    const memberMember = await prisma.organizationMember.create({
      data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' },
    });

    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'Campus' } });
    const building = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'HQ' } });
    buildingId = building.id;
    const floor = await prisma.property.create({ data: { organizationId: orgId, parentId: building.id, type: 'FLOOR', name: 'F1' } });
    const otherBuilding = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'Annex' } });
    outOfScopeBuildingId = otherBuilding.id;
    const otherFloor = await prisma.property.create({ data: { organizationId: orgId, parentId: otherBuilding.id, type: 'FLOOR', name: 'AF1' } });

    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'Core' } });
    const placed = await prisma.device.create({
      data: { organizationId: orgId, name: 'SW1', category: 'SWITCH', propertyId: floor.id, networkId: net.id, ipAddress: '10.0.0.5' },
    });
    placedDeviceId = placed.id;
    const unstatused = await prisma.device.create({
      data: { organizationId: orgId, name: 'SW2', category: 'SWITCH', propertyId: floor.id, networkId: net.id },
    });
    unstatusedDeviceId = unstatused.id;
    const outDev = await prisma.device.create({
      data: { organizationId: orgId, name: 'SW3', category: 'SWITCH', propertyId: otherFloor.id, networkId: net.id, ipAddress: '10.0.0.9' },
    });
    outOfScopeDeviceId = outDev.id;

    // a current status (UP) for the placed device only
    await prisma.deviceStatus.create({
      data: { organizationId: orgId, deviceId: placedDeviceId, state: 'UP', latencyMs: 12, consecutiveFails: 0, source: 'prober', lastCheckAt: new Date(), lastOkAt: new Date(), lastChangeAt: new Date() },
    });
    // a latency metric sample for the placed device
    await prisma.$executeRaw`INSERT INTO "MonitoringMetric" ("time","organizationId","deviceId","metric","value","source")
      VALUES (now(), ${orgId}, ${placedDeviceId}, 'latency_ms', 12, 'prober')`;

    // a status event for the placed device (Spec A)
    await prisma.$executeRaw`INSERT INTO "DeviceStatusEvent" ("time","organizationId","deviceId","state","source")
      VALUES (now(), ${orgId}, ${placedDeviceId}, 'UP', 'prober')`;

    // F3: grant the MEMBER scope at the HQ building only (not the Annex)
    await prisma.memberProperty.create({ data: { organizationId: orgId, memberId: memberMember.id, propertyId: building.id } });
  });

  afterAll(async () => {
    await prisma.deviceStatus.deleteMany({ where: { organizationId: orgId } });
    await prisma.$executeRaw`DELETE FROM "MonitoringMetric" WHERE "organizationId" = ${orgId}`;
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.memberProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId, type: 'FLOOR' } });
    await prisma.property.deleteMany({ where: { organizationId: orgId, type: 'BUILDING' } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
  });

  it('OWNER device-status: placed=UP, unstatused defaults to UNKNOWN', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/device-status`)
      .set('Cookie', ownerCookie)
      .expect(200);
    const byId = Object.fromEntries(res.body.data.map((s: { deviceId: string; state: string }) => [s.deviceId, s.state]));
    expect(byId[placedDeviceId]).toBe('UP');
    expect(byId[unstatusedDeviceId]).toBe('UNKNOWN');
  });

  it('an in-scope MEMBER sees the building statuses', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/device-status`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(res.body.data.length).toBe(2);
  });

  it('a MEMBER outside the building scope gets none of its statuses', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${outOfScopeBuildingId}/device-status`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('OWNER metrics: returns a bucketed latency series', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${placedDeviceId}/metrics?metric=latency_ms&from=${from}&to=${to}&bucket=5 minutes`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].avg).toBeCloseTo(12, 3);
  });

  it('a MEMBER cannot read metrics for an out-of-scope device (404)', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    await request(app.getHttpServer())
      .get(`/api/v1/devices/${outOfScopeDeviceId}/metrics?metric=latency_ms&from=${from}&to=${to}&bucket=5 minutes`)
      .set('Cookie', memberCookie)
      .expect(404);
  });

  // Spec A: status-events endpoint
  it('OWNER status-events: returns the seeded UP event with ISO time, state, source', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${placedDeviceId}/status-events`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.timestamp).toBeTruthy();
    expect(res.body.data.length).toBeGreaterThan(0);
    const event = res.body.data[0];
    expect(event.state).toBe('UP');
    expect(event.source).toBe('prober');
    expect(event.time).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO string
  });

  it('status-events: out-of-scope MEMBER gets 404', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/devices/${outOfScopeDeviceId}/status-events`)
      .set('Cookie', memberCookie)
      .expect(404);
  });

  it('status-events: in-scope MEMBER can read events for their device', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${placedDeviceId}/status-events`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('status-events: limit query param is respected (limit=1 returns at most 1)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${placedDeviceId}/status-events?limit=1`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  // Spec A: metric-names endpoint
  it('OWNER metric-names: returns the seeded latency_ms metric name', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${placedDeviceId}/metric-names`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.timestamp).toBeTruthy();
    expect(res.body.data).toContain('latency_ms');
  });

  it('metric-names: out-of-scope MEMBER gets 404', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/devices/${outOfScopeDeviceId}/metric-names`)
      .set('Cookie', memberCookie)
      .expect(404);
  });

  it('metric-names: in-scope MEMBER can read metric names for their device', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${placedDeviceId}/metric-names`)
      .set('Cookie', memberCookie)
      .expect(200);
    expect(res.body.data).toContain('latency_ms');
  });
});
