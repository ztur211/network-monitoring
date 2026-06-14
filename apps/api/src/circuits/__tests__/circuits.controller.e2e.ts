import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/circuits/* endpoints.
 * Requires running test database and Redis.
 */
describe('CircuitsController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let memberCookie: string;
  let circuitId: string;
  let orgId: string;
  const testEmail = `e2e-circuits-${Date.now()}@example.com`;
  const memberEmail = `e2e-circuits-member-${Date.now()}@example.com`;

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

    sessionCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: testEmail, password: 'Password123!', name: 'Circuits Test User' }),
    );

    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'Circuits Member User' }),
    );

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Circuits ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: member.id, organizationId: orgId, role: 'MEMBER' } });
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [testEmail, memberEmail] } } });
    await app.close();
  });

  describe('POST /api/v1/circuits', () => {
    it('returns 201 with CircuitDto on success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/circuits')
        .set('Cookie', sessionCookie)
        .send({ ispName: 'Comcast', serviceType: 'Fiber' });

      expect(res.status).toBe(201);
      expect(res.body.data.ispName).toBe('Comcast');
      circuitId = res.body.data.id;
    });

    it('returns 400 GEN_001 for missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/circuits')
        .set('Cookie', sessionCookie)
        .send({ ispName: 'ISP only' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GEN_001');
    });
  });

  describe('GET /api/v1/circuits', () => {
    it('returns cursor-paginated list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/circuits')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toBeDefined();
      expect(res.body.data.total).toBeGreaterThan(0);
      expect('nextCursor' in res.body.data).toBe(true);
    });
  });

  describe('GET /api/v1/circuits/:id', () => {
    it('returns 200 with CircuitDto', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/circuits/${circuitId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(circuitId);
    });

    it('returns 404 CIRCUIT_001 for non-existent circuit', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/circuits/00000000-0000-0000-0000-000000000000')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CIRCUIT_001');
    });
  });

  describe('PATCH /api/v1/circuits/:id', () => {
    it('returns 200 with updated CircuitDto', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/circuits/${circuitId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'bandwidth', oldValue: null, newValue: 1000 }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.bandwidth).toBe(1000);
      expect(res.body.data.version).toBe(2);
    });
  });

  describe('DELETE /api/v1/circuits/:id', () => {
    it('returns 200 and removes circuit', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/circuits/${circuitId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });

  describe('MEMBER read-only on circuits', () => {
    it('MEMBER GET /api/v1/circuits → 200 (read is allowed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/circuits')
        .set('Cookie', memberCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('MEMBER POST /api/v1/circuits → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/circuits')
        .set('Cookie', memberCookie)
        .send({ ispName: 'Member ISP', serviceType: 'Fiber' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER PATCH /api/v1/circuits/:id → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/circuits/00000000-0000-0000-0000-000000000001')
        .set('Cookie', memberCookie)
        .send({ baseVersion: 1, changes: [{ field: 'bandwidth', oldValue: null, newValue: 500 }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER DELETE /api/v1/circuits/:id → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/circuits/00000000-0000-0000-0000-000000000001')
        .set('Cookie', memberCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });
  });
});
