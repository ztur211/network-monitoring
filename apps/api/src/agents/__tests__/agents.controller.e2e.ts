import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E for Phase D Task 2: OWNER/ADMIN agent management endpoints.
 *
 * POST   /v1/agents/enrollment-code  — generate code (OWNER only)
 * GET    /v1/agents                  — list agents (OWNER/ADMIN only)
 * POST   /v1/agents/:id/revoke       — revoke agent (OWNER/ADMIN only)
 * DELETE /v1/agents/:id              — delete agent (OWNER/ADMIN only)
 *
 * Also validates that a revoked agent's token is rejected by the ingest endpoint.
 *
 * Run: npm run test:e2e -- agents.controller
 */
describe('AgentsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let orgId: string;
  let ownerCookie: string;
  let memberCookie: string;

  const ownerEmail = `e2e-agents-owner-${Date.now()}@example.com`;
  const memberEmail = `e2e-agents-member-${Date.now()}@example.com`;
  const password = 'Password123!';

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // Sign up owner and member
    ownerCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password, name: 'AgentOwner' }),
    );
    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password, name: 'AgentMember' }),
    );

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });

    const org = await prisma.organization.create({
      data: { name: `E2E Agents Org ${Date.now()}` },
    });
    orgId = org.id;

    await prisma.organizationMember.createMany({
      data: [
        { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' },
        { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.agentEnrollmentCode.deleteMany({ where: { organizationId: orgId } });
    await prisma.agent.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // OWNER: full management flow
  // ---------------------------------------------------------------------------

  describe('OWNER full flow', () => {
    let enrollmentCode: string;
    let agentId: string;
    let agentToken: string;

    it('POST /v1/agents/enrollment-code → 201 + code', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/agents/enrollment-code')
        .set('Cookie', ownerCookie)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.code).toBe('string');
      expect(res.body.data.code.length).toBeGreaterThan(0);
      expect(res.body.timestamp).toBeDefined();
      enrollmentCode = res.body.data.code;
    });

    it('POST /v1/monitoring/agent/enroll with that code → 201 + token+agentId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/monitoring/agent/enroll')
        .send({ code: enrollmentCode, name: 'e2e-agent', platform: 'linux', version: '1.0.0' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.agentId).toBeTruthy();
      expect(res.body.data.token).toBeTruthy();
      agentId = res.body.data.agentId;
      agentToken = res.body.data.token;
    });

    it('GET /v1/agents → 200 + the enrolled agent listed with status APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agents')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const agent = res.body.data.find((a: { id: string }) => a.id === agentId);
      expect(agent).toBeDefined();
      expect(agent.status).toBe('APPROVED');
      expect(agent.name).toBe('e2e-agent');
      expect(agent.platform).toBe('linux');
      expect(agent.version).toBe('1.0.0');
    });

    it('POST /v1/agents/:id/revoke → 200 + { id }', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/agents/${agentId}/revoke`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(agentId);
    });

    it('GET /v1/monitoring/agent/devices with the revoked token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/monitoring/agent/devices')
        .set('x-agent-token', agentToken)
        .expect(401);
    });

    it('DELETE /v1/agents/:id → 200 + { id } (cleanup)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/agents/${agentId}`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(agentId);
    });
  });

  // ---------------------------------------------------------------------------
  // MEMBER: role-gated rejection
  // ---------------------------------------------------------------------------

  describe('MEMBER access', () => {
    it('GET /v1/agents → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agents')
        .set('Cookie', memberCookie)
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('POST /v1/agents/enrollment-code → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/agents/enrollment-code')
        .set('Cookie', memberCookie)
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Org-scope security: revoke/delete agent of another org → 404
  // ---------------------------------------------------------------------------

  describe('cross-org access', () => {
    let foreignOrgId: string;
    let foreignAgentId: string;

    beforeAll(async () => {
      // Create a foreign org with an agent
      const foreignOrg = await prisma.organization.create({
        data: { name: `E2E Foreign Org ${Date.now()}` },
      });
      foreignOrgId = foreignOrg.id;
      const foreignAgent = await prisma.agent.create({
        data: {
          organizationId: foreignOrgId,
          name: 'foreign-agent',
          platform: 'linux',
          version: '1.0.0',
          status: 'APPROVED',
          tokenHash: 'dummy-hash-for-cross-org-test',
          createdByMemberId: null,
        },
      });
      foreignAgentId = foreignAgent.id;
    });

    afterAll(async () => {
      await prisma.agent.deleteMany({ where: { organizationId: foreignOrgId } });
      await prisma.organization.delete({ where: { id: foreignOrgId } });
    });

    it('OWNER of org A cannot revoke agent of org B → 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/agents/${foreignAgentId}/revoke`)
        .set('Cookie', ownerCookie)
        .expect(404);

      expect(res.body.error.code).toBe('AGENT_002');
    });

    it('OWNER of org A cannot delete agent of org B → 404', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/agents/${foreignAgentId}`)
        .set('Cookie', ownerCookie)
        .expect(404);

      expect(res.body.error.code).toBe('AGENT_002');
    });
  });
});
