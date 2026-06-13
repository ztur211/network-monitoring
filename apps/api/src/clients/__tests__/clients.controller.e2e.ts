import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

// E2E tests — require test DB and running services
// Run with: npm run test:e2e --workspace=apps/api

describe('GET /api/v1/clients', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let orgId: string;
  const testEmail = `e2e-clients-${Date.now()}@example.com`;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    const signUpRes = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: testEmail, password: 'Password123!', name: 'Clients Test User' });
    const setCookie = signUpRes.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? '');

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Clients ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  describe('when not authenticated', () => {
    it('returns 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/clients').expect(401);
    });
  });

  describe('when authenticated', () => {
    it('returns 200 with currentDevice and agentStatus', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/clients')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.currentDevice).toBeDefined();
      expect(res.body.data.currentDevice.userAgent).toBeDefined();
      expect(res.body.data.agentStatus.available).toBe(false);
      expect(typeof res.body.data.agentStatus.message).toBe('string');
    });

    it('agentStatus.available is always false in MVP', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/clients')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(res.body.data.agentStatus.available).toBe(false);
    });
  });
});
