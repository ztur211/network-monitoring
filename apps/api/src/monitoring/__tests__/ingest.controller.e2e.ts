import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentTokenService } from '../../agents/agent-token.service';

/**
 * E2E for the Spec 7 HTTP ingest + token endpoints. Requires the test stack (:5433/:6380/:9100).
 * Run: npm run test:e2e -- ingest.controller
 */
describe('IngestController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agentTokens: AgentTokenService;
  let ownerCookie: string;
  let orgId: string;
  let buildingId: string;
  let deviceId: string;
  let foreignDeviceId: string;
  let foreignOrgId: string;
  const ownerEmail = `e2e-ingest-owner-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    agentTokens = app.get(AgentTokenService);

    const signUp = async (email: string, name: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'Password123!', name });
      const c = res.headers['set-cookie'];
      return Array.isArray(c) ? c[0] : c;
    };
    ownerCookie = await signUp(ownerEmail, 'Ingest Owner');
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Ingest ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });

    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: 'Campus' } });
    const building = await prisma.property.create({ data: { organizationId: orgId, parentId: site.id, type: 'BUILDING', name: 'HQ' } });
    buildingId = building.id;
    const floor = await prisma.property.create({ data: { organizationId: orgId, parentId: building.id, type: 'FLOOR', name: 'F1' } });
    const net = await prisma.network.create({ data: { organizationId: orgId, name: 'Core' } });
    const dev = await prisma.device.create({
      data: { organizationId: orgId, name: 'SW1', category: 'SWITCH', propertyId: floor.id, networkId: net.id, ipAddress: '10.0.0.5' },
    });
    deviceId = dev.id;

    // a foreign org + device the token must never be able to write
    const foreignOrg = await prisma.organization.create({ data: { name: `E2E Foreign ${Date.now()}` } });
    foreignOrgId = foreignOrg.id;
    const fSite = await prisma.property.create({ data: { organizationId: foreignOrgId, parentId: null, type: 'SITE', name: 'FS' } });
    const fNet = await prisma.network.create({ data: { organizationId: foreignOrgId, name: 'FN' } });
    const fDev = await prisma.device.create({
      data: { organizationId: foreignOrgId, name: 'FSW', category: 'SWITCH', propertyId: fSite.id, networkId: fNet.id },
    });
    foreignDeviceId = fDev.id;
  });

  afterAll(async () => {
    for (const oid of [orgId, foreignOrgId]) {
      await prisma.deviceStatus.deleteMany({ where: { organizationId: oid } });
      await prisma.$executeRaw`DELETE FROM "MonitoringMetric" WHERE "organizationId" = ${oid}`;
      await prisma.monitoringIngestToken.deleteMany({ where: { organizationId: oid } });
      await prisma.agentEnrollmentCode.deleteMany({ where: { organizationId: oid } });
      await prisma.agent.deleteMany({ where: { organizationId: oid } });
      await prisma.device.deleteMany({ where: { organizationId: oid } });
      await prisma.network.deleteMany({ where: { organizationId: oid } });
      await prisma.property.deleteMany({ where: { organizationId: oid, type: 'FLOOR' } });
      await prisma.property.deleteMany({ where: { organizationId: oid, type: 'BUILDING' } });
      await prisma.property.deleteMany({ where: { organizationId: oid } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: oid } });
      await prisma.organization.delete({ where: { id: oid } });
    }
    await app.close();
  });

  it('OWNER mints a token, then an ingest with it sets device status UP', async () => {
    const mint = await request(app.getHttpServer())
      .post('/api/v1/monitoring/ingest-token')
      .set('Cookie', ownerCookie)
      .expect(201);
    const token = mint.body.data.token as string;
    expect(token).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/monitoring/ingest')
      .set('x-ingest-token', token)
      .send({ checks: [{ deviceId, ok: true, latencyMs: 9 }] })
      .expect(202);

    const s = await request(app.getHttpServer())
      .get(`/api/v1/buildings/${buildingId}/device-status`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(s.body.data.find((x: { deviceId: string }) => x.deviceId === deviceId).state).toBe('UP');
  });

  it('rejects a bad token (401)', () =>
    request(app.getHttpServer())
      .post('/api/v1/monitoring/ingest')
      .set('x-ingest-token', 'nope')
      .send({ checks: [] })
      .expect(401));

  it('rejects an ingest with no token (401)', () =>
    request(app.getHttpServer())
      .post('/api/v1/monitoring/ingest')
      .send({ checks: [] })
      .expect(401));

  it('rejects a device from another org (404 / ORG_008)', async () => {
    const mint = await request(app.getHttpServer())
      .post('/api/v1/monitoring/ingest-token')
      .set('Cookie', ownerCookie)
      .expect(201);
    const token = mint.body.data.token as string;
    await request(app.getHttpServer())
      .post('/api/v1/monitoring/ingest')
      .set('x-ingest-token', token)
      .send({ checks: [{ deviceId: foreignDeviceId, ok: true }] })
      .expect(404);
  });

  it('a non-OWNER session cannot mint a token (no OWNER role)', async () => {
    const memberEmail = `e2e-ingest-mem-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: memberEmail, password: 'Password123!', name: 'Mem' });
    const cookie = (Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'][0] : res.headers['set-cookie']) as string;
    const memUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    await prisma.organizationMember.create({ data: { userId: memUser.id, organizationId: orgId, role: 'MEMBER' } });
    await request(app.getHttpServer())
      .post('/api/v1/monitoring/ingest-token')
      .set('Cookie', cookie)
      .expect(403);
    await prisma.organizationMember.deleteMany({ where: { userId: memUser.id } });
  });

  it('accepts an agent token (x-agent-token) and tags DeviceStatus.source = agent:<id>', async () => {
    // Enroll a real agent via AgentTokenService (no HTTP – direct service call).
    const code = await agentTokens.generateEnrollmentCode(orgId, null);
    const { agentId, token } = await agentTokens.enroll(code, { name: 'e2e-agent', platform: 'linux', version: '0.0.1' });

    // Ingest a check using the agent token.
    await request(app.getHttpServer())
      .post('/api/v1/monitoring/ingest')
      .set('x-agent-token', token)
      .send({ checks: [{ deviceId, ok: true, latencyMs: 4 }] })
      .expect(202);

    // Verify the persisted DeviceStatus row carries the agent-tagged source.
    const row = await prisma.deviceStatus.findFirst({ where: { deviceId, source: `agent:${agentId}` } });
    expect(row).not.toBeNull();
    expect(row?.source).toBe(`agent:${agentId}`);
  });
});
