import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/onboarding/* endpoints.
 * Requires running test database and Redis.
 *
 * Security invariant: POST /v1/onboarding/turn mutates the org Network model
 * (name/isp/speeds/homePublicIp/lat/lng via persistNetworkFields) and MUST be
 * gated to OWNER/ADMIN only.  POST /v1/onboarding/skip writes only a per-user
 * Redis dismissal key and MUST remain open to all authenticated org members.
 */
describe('OnboardingController (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let memberCookie: string;
  let orgId: string;
  let ownerId: string;
  let memberId: string;

  const ownerEmail = `e2e-onboarding-owner-${Date.now()}@example.com`;
  const memberEmail = `e2e-onboarding-member-${Date.now()}@example.com`;

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    // Sign up owner
    ownerCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password: 'Password123!', name: 'Onboarding Owner' }),
    );

    // Sign up member
    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'Onboarding Member' }),
    );

    const prisma = app.get(PrismaService);
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    ownerId = ownerUser.id;
    memberId = memberUser.id;

    const org = await prisma.organization.create({
      data: { name: `E2E Onboarding ${Date.now()}` },
    });
    orgId = org.id;

    await prisma.organizationMember.create({
      data: { userId: ownerId, organizationId: orgId, role: 'OWNER' },
    });
    await prisma.organizationMember.create({
      data: { userId: memberId, organizationId: orgId, role: 'MEMBER' },
    });
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    // Clean up any networks the onboarding service may have created for this org
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  describe('MEMBER role-gate on POST /api/v1/onboarding/turn', () => {
    it('MEMBER POST /api/v1/onboarding/turn → 403 ORG_003 (network-write path blocked)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/onboarding/turn')
        .set('Cookie', memberCookie)
        .send({ userMessage: 'hello' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });
  });

  describe('MEMBER can still skip (per-user Redis, not a network mutation)', () => {
    it('MEMBER POST /api/v1/onboarding/skip → 200 (skip stays open to members)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/onboarding/skip')
        .set('Cookie', memberCookie)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('OWNER can call POST /api/v1/onboarding/turn (sanity smoke)', () => {
    it('OWNER POST /api/v1/onboarding/turn → NOT 403 (owner is allowed)', async () => {
      // We only assert the owner is not blocked by the role guard.
      // The response may be 200 (turn processed) or some other non-403 status
      // depending on AI provider availability, but it must not be 403 ORG_003.
      const res = await request(app.getHttpServer())
        .post('/api/v1/onboarding/turn')
        .set('Cookie', ownerCookie)
        .send({ userMessage: 'hello' });

      expect(res.status).not.toBe(403);
      // If there is an error body, confirm it is NOT the role-gate error
      if (res.body?.error?.code) {
        expect(res.body.error.code).not.toBe('ORG_003');
      }
    });
  });
});
