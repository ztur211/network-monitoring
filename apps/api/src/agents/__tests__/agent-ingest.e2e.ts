import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentTokenService } from '../agent-token.service';

/**
 * E2E for Phase D Task 1: agent-facing endpoints
 *   POST /v1/monitoring/agent/enroll   — exchange enrollment code → token
 *   GET  /v1/monitoring/agent/devices  — list org devices that have an IP
 *   POST /v1/monitoring/agent/heartbeat — 204 bump lastSeenAt
 *
 * Run: npm run test:e2e -- agent-ingest
 */
describe('AgentIngestController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agentTokens: AgentTokenService;

  let orgId: string;
  let ipDeviceId: string;
  let noIpDeviceId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    agentTokens = app.get(AgentTokenService);

    // Create an org + two devices: one with an IP, one without.
    const org = await prisma.organization.create({
      data: { name: `E2E AgentIngest ${Date.now()}` },
    });
    orgId = org.id;

    const site = await prisma.property.create({
      data: {
        organizationId: orgId,
        parentId: null,
        type: 'SITE',
        name: 'Campus',
      },
    });
    const net = await prisma.network.create({
      data: { organizationId: orgId, name: 'Core' },
    });

    const devWithIp = await prisma.device.create({
      data: {
        organizationId: orgId,
        name: 'SW-with-IP',
        category: 'SWITCH',
        propertyId: site.id,
        networkId: net.id,
        ipAddress: '192.168.1.10',
      },
    });
    ipDeviceId = devWithIp.id;

    const devNoIp = await prisma.device.create({
      data: {
        organizationId: orgId,
        name: 'SW-no-IP',
        category: 'SWITCH',
        propertyId: site.id,
        networkId: net.id,
        // ipAddress intentionally omitted
      },
    });
    noIpDeviceId = devNoIp.id;
  });

  afterAll(async () => {
    await prisma.agentEnrollmentCode.deleteMany({ where: { organizationId: orgId } });
    await prisma.agent.deleteMany({ where: { organizationId: orgId } });
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await app.close();
  });

  describe('POST /v1/monitoring/agent/enroll', () => {
    it('returns 201 + { agentId, token } when code is valid', async () => {
      const code = await agentTokens.generateEnrollmentCode(orgId, null);

      const res = await request(app.getHttpServer())
        .post('/api/v1/monitoring/agent/enroll')
        .send({ code, name: 'test-agent', platform: 'linux', version: '1.0.0' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.data.agentId).toBeTruthy();
      expect(res.body.data.token).toBeTruthy();
    });

    it('returns 401 with an invalid code', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/monitoring/agent/enroll')
        .send({ code: 'invalid-code-xyz', name: 'bad-agent', platform: 'linux', version: '1.0.0' })
        .expect(401);
    });
  });

  describe('GET /v1/monitoring/agent/devices', () => {
    let agentToken: string;

    beforeAll(async () => {
      // Enroll a fresh agent to get a valid token for device listing.
      const code = await agentTokens.generateEnrollmentCode(orgId, null);
      const enrolled = await agentTokens.enroll(code, {
        name: 'device-lister',
        platform: 'linux',
        version: '1.0.0',
      });
      agentToken = enrolled.token;
    });

    it('returns 200 + devices list containing only the IP-addressed device', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/monitoring/agent/devices')
        .set('x-agent-token', agentToken)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const ids = res.body.data.map((d: { id: string }) => d.id);
      expect(ids).toContain(ipDeviceId);
      expect(ids).not.toContain(noIpDeviceId);

      const device = res.body.data.find((d: { id: string }) => d.id === ipDeviceId);
      expect(device.ipAddress).toBe('192.168.1.10');
      expect(device.name).toBe('SW-with-IP');
    });

    it('returns 401 with a bad token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/monitoring/agent/devices')
        .set('x-agent-token', 'definitely-not-valid')
        .expect(401);
    });

    it('returns 401 with no token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/monitoring/agent/devices')
        .expect(401);
    });
  });

  describe('POST /v1/monitoring/agent/heartbeat', () => {
    it('returns 204 with a valid agent token', async () => {
      const code = await agentTokens.generateEnrollmentCode(orgId, null);
      const { token } = await agentTokens.enroll(code, {
        name: 'heartbeat-agent',
        platform: 'linux',
        version: '1.0.0',
      });

      await request(app.getHttpServer())
        .post('/api/v1/monitoring/agent/heartbeat')
        .set('x-agent-token', token)
        .expect(204);
    });

    it('returns 401 with no token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/monitoring/agent/heartbeat')
        .expect(401);
    });
  });
});
