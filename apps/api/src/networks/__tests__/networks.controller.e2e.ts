import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/networks/* endpoints.
 * Requires running test database and Redis.
 */
describe('NetworksController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let networkId: string;
  const testEmail = `e2e-networks-${Date.now()}@example.com`;

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

    const signUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: testEmail, password: 'Password123!', name: 'Networks Test User' });

    const setCookie = signUp.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  describe('POST /api/v1/networks', () => {
    it('returns 201 with NetworkDetail (including homePublicIp) on first create', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/networks')
        .set('Cookie', sessionCookie)
        .send({
          name: 'Home',
          homeAddress: '1 Main St',
          homePublicIp: '203.0.113.1',
          isp: 'Comcast',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Home');
      expect(res.body.data.homePublicIp).toBe('203.0.113.1');
      expect(res.body.data.version).toBe(1);
      networkId = res.body.data.id;
    });

    it('returns 409 NETWORK_001 NETWORK_LIMIT_EXCEEDED on second create', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/networks')
        .set('Cookie', sessionCookie)
        .send({ name: 'Second Home' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NETWORK_001');
    });

    it('returns 400 GEN_001 for missing name', async () => {
      const otherEmail = `e2e-networks-bad-${Date.now()}@example.com`;
      const otherSignUp = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: otherEmail, password: 'Password123!', name: 'Other' });
      const otherCookie = Array.isArray(otherSignUp.headers['set-cookie'])
        ? otherSignUp.headers['set-cookie'][0]
        : otherSignUp.headers['set-cookie'];

      const res = await request(app.getHttpServer())
        .post('/api/v1/networks')
        .set('Cookie', otherCookie)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GEN_001');

      const prisma = app.get(PrismaService);
      await prisma.user.deleteMany({ where: { email: otherEmail } });
    });
  });

  describe('GET /api/v1/networks', () => {
    it('returns 200 with NetworkSummary list (never includes homePublicIp)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/networks')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).not.toHaveProperty('homePublicIp');
    });
  });

  describe('GET /api/v1/networks/:id', () => {
    it('returns 200 with NetworkDetail including homePublicIp', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/networks/${networkId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.homePublicIp).toBe('203.0.113.1');
    });

    it('returns 404 NETWORK_002 for non-existent network', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/networks/00000000-0000-0000-0000-000000000000')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NETWORK_002');
    });
  });

  describe('PATCH /api/v1/networks/:id', () => {
    it('returns 200 with incremented version', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${networkId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'isp', oldValue: 'Comcast', newValue: 'Verizon' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.isp).toBe('Verizon');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 SYNC_001 on version mismatch', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${networkId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'isp', oldValue: 'Verizon', newValue: 'AT&T' }],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SYNC_001');
    });
  });

  describe('DELETE /api/v1/networks/:id', () => {
    it('returns 200 and removes network', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/networks/${networkId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();

      const follow = await request(app.getHttpServer())
        .get(`/api/v1/networks/${networkId}`)
        .set('Cookie', sessionCookie);
      expect(follow.status).toBe(404);
    });

    it('returns 404 NETWORK_002 when deleting non-existent network', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/networks/00000000-0000-0000-0000-000000000000')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NETWORK_002');
    });
  });
});
