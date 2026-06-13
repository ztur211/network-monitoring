import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/fiber-runs/* endpoints.
 * Requires running test database and Redis.
 */
describe('FiberRunsController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let deviceAId: string;
  let deviceBId: string;
  let fiberRunId: string;
  let orgId: string;
  let networkId: string;
  let siteId: string;
  const testEmail = `e2e-fiber-${Date.now()}@example.com`;

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
      .send({ email: testEmail, password: 'Password123!', name: 'FiberRuns Test User' });

    const setCookie = signUp.headers['set-cookie'];
    sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E FiberRuns ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });

    const network = await prisma.network.create({ data: { organizationId: orgId, userId: u.id, name: `Net ${Date.now()}` } });
    networkId = network.id;
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `HQ ${Date.now()}` } });
    siteId = site.id;
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: network.id, propertyId: site.id } });

    const [devA, devB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Fiber Start', category: 'ROUTER', networkId, propertyId: siteId }),
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Fiber End', category: 'SWITCH', networkId, propertyId: siteId }),
    ]);
    deviceAId = devA.body.data.id;
    deviceBId = devB.body.data.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.fiberRun.deleteMany({ where: { organizationId: orgId } });
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  describe('POST /api/v1/fiber-runs', () => {
    it('returns 201 with FiberRunDto on success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/fiber-runs')
        .set('Cookie', sessionCookie)
        .send({ name: 'Main Fiber', startDeviceId: deviceAId, endDeviceId: deviceBId });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Main Fiber');
      fiberRunId = res.body.data.id;
    });

    it('returns 422 FIBER_002 when start and end device are the same', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/fiber-runs')
        .set('Cookie', sessionCookie)
        .send({ name: 'Same Device', startDeviceId: deviceAId, endDeviceId: deviceAId });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('FIBER_002');
    });
  });

  describe('GET /api/v1/fiber-runs', () => {
    it('returns fiber runs list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/fiber-runs')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/fiber-runs/:id', () => {
    it('returns 200 with FiberRunDto', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/fiber-runs/${fiberRunId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(fiberRunId);
    });

    it('returns 404 FIBER_001 for non-existent run', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/fiber-runs/00000000-0000-0000-0000-000000000000')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FIBER_001');
    });
  });

  describe('PATCH /api/v1/fiber-runs/:id', () => {
    it('returns 200 with updated FiberRunDto', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/fiber-runs/${fiberRunId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'cableType', oldValue: null, newValue: 'OM3 Multimode' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.cableType).toBe('OM3 Multimode');
      expect(res.body.data.version).toBe(2);
    });
  });

  describe('DELETE /api/v1/fiber-runs/:id', () => {
    it('returns 200 and removes the fiber run', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/fiber-runs/${fiberRunId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });
});
