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
  let memberCookie: string;
  let adminSaOnlyCookie: string; // ADMIN scoped to siteA only
  let adminBothCookie: string;   // ADMIN scoped to both sites
  let deviceAId: string; // under siteA
  let deviceBId: string; // under siteB
  let fiberRunId: string;
  let memberGuardRunId: string; // persists through MEMBER tests
  let crossRunId: string; // cross-site fiber run (siteA ↔ siteB)
  let orgId: string;
  let networkId: string;
  let siteAId: string;
  let siteBId: string;
  const testEmail = `e2e-fiber-${Date.now()}@example.com`;
  const memberEmail = `e2e-fiber-member-${Date.now()}@example.com`;
  const adminSaOnlyEmail = `e2e-fiber-admin-sa-${Date.now()}@example.com`;
  const adminBothEmail = `e2e-fiber-admin-both-${Date.now()}@example.com`;

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

    // Register all users
    sessionCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: testEmail, password: 'Password123!', name: 'FiberRuns Test User' }),
    );

    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'FiberRuns Member User' }),
    );

    adminSaOnlyCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminSaOnlyEmail, password: 'Password123!', name: 'FiberRuns Admin SA User' }),
    );

    adminBothCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminBothEmail, password: 'Password123!', name: 'FiberRuns Admin Both User' }),
    );

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const adminSaOnly = await prisma.user.findUniqueOrThrow({ where: { email: adminSaOnlyEmail } });
    const adminBoth = await prisma.user.findUniqueOrThrow({ where: { email: adminBothEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E FiberRuns ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: member.id, organizationId: orgId, role: 'MEMBER' } });
    const adminSaOrgMember = await prisma.organizationMember.create({ data: { userId: adminSaOnly.id, organizationId: orgId, role: 'ADMIN' } });
    const adminBothOrgMember = await prisma.organizationMember.create({ data: { userId: adminBoth.id, organizationId: orgId, role: 'ADMIN' } });

    const network = await prisma.network.create({ data: { organizationId: orgId, userId: u.id, name: `Net ${Date.now()}` } });
    networkId = network.id;

    // Two distinct sites
    const siteA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `SiteA ${Date.now()}` } });
    const siteB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `SiteB ${Date.now()}` } });
    siteAId = siteA.id;
    siteBId = siteB.id;
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: network.id, propertyId: siteA.id } });
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: network.id, propertyId: siteB.id } });

    // adminSaOnly scoped to siteA only; adminBoth scoped to both
    await prisma.memberProperty.create({ data: { organizationId: orgId, memberId: adminSaOrgMember.id, propertyId: siteAId } });
    await prisma.memberProperty.create({ data: { organizationId: orgId, memberId: adminBothOrgMember.id, propertyId: siteAId } });
    await prisma.memberProperty.create({ data: { organizationId: orgId, memberId: adminBothOrgMember.id, propertyId: siteBId } });

    // deviceA at siteA, deviceB at siteB
    const [devA, devB] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Fiber Start', category: 'ROUTER', networkId, propertyId: siteAId }),
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Fiber End', category: 'SWITCH', networkId, propertyId: siteBId }),
    ]);
    deviceAId = devA.body.data.id;
    deviceBId = devB.body.data.id;

    // Seed a fiber run that persists for MEMBER guard tests
    // Uses deviceA (siteA) × deviceB (siteB) — MEMBER should get ORG_003 on write
    const memberGuardRes = await request(app.getHttpServer())
      .post('/api/v1/fiber-runs')
      .set('Cookie', sessionCookie)
      .send({ name: 'Member Guard Run', startDeviceId: deviceAId, endDeviceId: deviceBId });
    memberGuardRunId = memberGuardRes.body.data.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.fiberRun.deleteMany({ where: { organizationId: orgId } });
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.memberProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [testEmail, memberEmail, adminSaOnlyEmail, adminBothEmail] } } });
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

  describe('MEMBER read-only on fiber-runs', () => {
    it('MEMBER GET /api/v1/fiber-runs → 200 (read is allowed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/fiber-runs')
        .set('Cookie', memberCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('MEMBER POST /api/v1/fiber-runs → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/fiber-runs')
        .set('Cookie', memberCookie)
        .send({ name: 'Member Fiber', startDeviceId: deviceAId, endDeviceId: deviceBId });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER PATCH existing fiber run → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/fiber-runs/${memberGuardRunId}`)
        .set('Cookie', memberCookie)
        .send({ baseVersion: 1, changes: [{ field: 'cableType', oldValue: null, newValue: 'blocked' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER DELETE existing fiber run → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/fiber-runs/${memberGuardRunId}`)
        .set('Cookie', memberCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });
  });

  describe('F3 scoped enforcement — inter-site-link rule', () => {
    // Creates cross-site crossRun (siteA ↔ siteB) as OWNER for scope tests
    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/fiber-runs')
        .set('Cookie', sessionCookie)
        .send({ name: 'Cross Site Fiber', startDeviceId: deviceAId, endDeviceId: deviceBId });
      expect(res.status).toBe(201);
      crossRunId = res.body.data.id;
    });

    it('ADMIN (siteA only) GET fiber-runs → includes crossRun (visible via siteA endpoint)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/fiber-runs')
        .set('Cookie', adminSaOnlyCookie);

      expect(res.status).toBe(200);
      const ids = (res.body.data.items as { id: string }[]).map((r) => r.id);
      expect(ids).toContain(crossRunId);
    });

    it('ADMIN (siteA only) GET /fiber-runs/:id for crossRun → 200 (visible via siteA endpoint)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/fiber-runs/${crossRunId}`)
        .set('Cookie', adminSaOnlyCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(crossRunId);
    });

    it('ADMIN (siteA only) DELETE crossRun → 403 PERM_001 (siteB endpoint out of scope)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/fiber-runs/${crossRunId}`)
        .set('Cookie', adminSaOnlyCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_001');
    });

    it('ADMIN (siteA only) PATCH crossRun → 403 PERM_001 (siteB endpoint out of scope)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/fiber-runs/${crossRunId}`)
        .set('Cookie', adminSaOnlyCookie)
        .send({ baseVersion: 1, changes: [{ field: 'notes', oldValue: null, newValue: 'blocked' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_001');
    });

    it('ADMIN (both sites) DELETE crossRun → 200 success', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/fiber-runs/${crossRunId}`)
        .set('Cookie', adminBothCookie);

      expect(res.status).toBe(200);
    });

    it('OWNER POST cross-site fiber run → 201 success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/fiber-runs')
        .set('Cookie', sessionCookie)
        .send({ name: 'Owner Cross Fiber', startDeviceId: deviceAId, endDeviceId: deviceBId });

      expect(res.status).toBe(201);
      // Clean up
      crossRunId = res.body.data.id;
      await request(app.getHttpServer())
        .delete(`/api/v1/fiber-runs/${crossRunId}`)
        .set('Cookie', sessionCookie);
    });
  });
});
