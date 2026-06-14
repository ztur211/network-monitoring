import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/device-connections/* endpoints.
 * Requires running test database and Redis.
 */
describe('ConnectionsController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let memberCookie: string;
  let adminSaOnlyCookie: string; // ADMIN scoped to siteA only
  let adminBothCookie: string;   // ADMIN scoped to both sites
  let deviceAId: string; // under siteA
  let deviceBId: string; // under siteB
  let connectionId: string;  // OWNER connection, used for PATCH/DELETE tests
  let memberGuardConnId: string; // persists through MEMBER tests
  let connABId: string; // cross-site connection (siteA ↔ siteB)
  let orgId: string;
  let networkId: string;
  let siteAId: string;
  let siteBId: string;
  const testEmail = `e2e-conn-${Date.now()}@example.com`;
  const memberEmail = `e2e-conn-member-${Date.now()}@example.com`;
  const adminSaOnlyEmail = `e2e-conn-admin-sa-${Date.now()}@example.com`;
  const adminBothEmail = `e2e-conn-admin-both-${Date.now()}@example.com`;

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
        .send({ email: testEmail, password: 'Password123!', name: 'Connections Test User' }),
    );

    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'Connections Member User' }),
    );

    adminSaOnlyCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminSaOnlyEmail, password: 'Password123!', name: 'Connections Admin SA User' }),
    );

    adminBothCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminBothEmail, password: 'Password123!', name: 'Connections Admin Both User' }),
    );

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const adminSaOnly = await prisma.user.findUniqueOrThrow({ where: { email: adminSaOnlyEmail } });
    const adminBoth = await prisma.user.findUniqueOrThrow({ where: { email: adminBothEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E Connections ${Date.now()}` } });
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
        .send({ name: 'Conn Src', category: 'ROUTER', networkId, propertyId: siteAId }),
      request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Conn Dst', category: 'SWITCH', networkId, propertyId: siteBId }),
    ]);
    deviceAId = devA.body.data.id;
    deviceBId = devB.body.data.id;

    // Seed a connection that persists for the MEMBER guard tests (uses siteA device × siteA device)
    // We need two devices on siteA for a same-site connection for the MEMBER guard test
    const devA2Res = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('Cookie', sessionCookie)
      .send({ name: 'Conn Src2', category: 'SWITCH', networkId, propertyId: siteAId });
    const deviceA2Id = devA2Res.body.data.id;
    const memberGuardRes = await request(app.getHttpServer())
      .post('/api/v1/device-connections')
      .set('Cookie', sessionCookie)
      .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceA2Id, connectionType: 'ETHERNET' });
    memberGuardConnId = memberGuardRes.body.data.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.deviceConnection.deleteMany({ where: { organizationId: orgId } });
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

  describe('POST /api/v1/device-connections', () => {
    it('returns 201 with DeviceConnectionDto (OWNER, cross-site)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', sessionCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceBId, connectionType: 'ETHERNET' });

      expect(res.status).toBe(201);
      expect(res.body.data.connectionType).toBe('ETHERNET');
      connectionId = res.body.data.id;
    });

    it('returns 422 CONN_002 for self-connection', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', sessionCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceAId, connectionType: 'ETHERNET' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CONN_002');
    });

    it('returns 409 CONN_003 for duplicate connection', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', sessionCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceBId, connectionType: 'ETHERNET' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONN_003');
    });
  });

  describe('GET /api/v1/device-connections', () => {
    it('returns list of connections', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/device-connections')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });
  });

  describe('PATCH /api/v1/device-connections/:id', () => {
    it('returns 200 with updated connection (OWNER cross-site)', async () => {
      // OWNER has both siteA and siteB — this is the write-both-sites path
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/device-connections/${connectionId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'Updated' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Updated');
    });
  });

  describe('DELETE /api/v1/device-connections/:id', () => {
    it('returns 200 and removes connection (OWNER cross-site)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/device-connections/${connectionId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
    });
  });

  describe('MEMBER read-only on connections', () => {
    it('MEMBER GET /api/v1/device-connections → 200 (read is allowed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/device-connections')
        .set('Cookie', memberCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('MEMBER POST /api/v1/device-connections → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', memberCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceBId, connectionType: 'ETHERNET' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER PATCH existing connection → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/device-connections/${memberGuardConnId}`)
        .set('Cookie', memberCookie)
        .send({ baseVersion: 1, changes: [{ field: 'notes', oldValue: null, newValue: 'blocked' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER DELETE existing connection → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/device-connections/${memberGuardConnId}`)
        .set('Cookie', memberCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });
  });

  describe('F3 scoped enforcement — inter-site-link rule', () => {
    // Creates cross-site connAB (siteA ↔ siteB) as OWNER for scope tests
    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', sessionCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceBId, connectionType: 'FIBER' });
      expect(res.status).toBe(201);
      connABId = res.body.data.id;
    });

    it('ADMIN (siteA only) GET connections → includes connAB (visible via siteA endpoint)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/device-connections')
        .set('Cookie', adminSaOnlyCookie);

      expect(res.status).toBe(200);
      const ids = (res.body.data.items as { id: string }[]).map((c) => c.id);
      expect(ids).toContain(connABId);
    });

    it('ADMIN (siteA only) DELETE connAB → 403 PERM_001 (siteB endpoint out of scope)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/device-connections/${connABId}`)
        .set('Cookie', adminSaOnlyCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_001');
    });

    it('ADMIN (siteA only) PATCH connAB → 403 PERM_001 (siteB endpoint out of scope)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/device-connections/${connABId}`)
        .set('Cookie', adminSaOnlyCookie)
        .send({ baseVersion: 1, changes: [{ field: 'notes', oldValue: null, newValue: 'blocked' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_001');
    });

    it('ADMIN (both sites) DELETE connAB → 200 success', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/device-connections/${connABId}`)
        .set('Cookie', adminBothCookie);

      expect(res.status).toBe(200);
    });

    it('OWNER POST cross-site connection → 201 success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/device-connections')
        .set('Cookie', sessionCookie)
        .send({ sourceDeviceId: deviceAId, targetDeviceId: deviceBId, connectionType: 'FIBER' });

      expect(res.status).toBe(201);
      // Clean up
      connABId = res.body.data.id;
      await request(app.getHttpServer())
        .delete(`/api/v1/device-connections/${connABId}`)
        .set('Cookie', sessionCookie);
    });
  });
});
