import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/devices/* endpoints.
 * Requires running test database and Redis.
 */
describe('DevicesController (e2e)', () => {
  let app: INestApplication;
  let sessionCookie: string;
  let memberCookie: string;
  let adminCookie: string;
  let orgId: string;
  let networkId: string;
  let siteId: string;
  let sBId: string;
  let deviceUnderBId: string;
  const testEmail = `e2e-devices-${Date.now()}@example.com`;
  const memberEmail = `e2e-devices-member-${Date.now()}@example.com`;
  const adminEmail = `e2e-devices-admin-${Date.now()}@example.com`;

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
        .send({ email: testEmail, password: 'Password123!', name: 'Devices Test User' }),
    );

    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'Devices Member User' }),
    );

    adminCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminEmail, password: 'Password123!', name: 'Devices Admin User' }),
    );

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Devices ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });
    const memberMembership = await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });
    const adminMembership = await prisma.organizationMember.create({ data: { userId: adminUser.id, organizationId: orgId, role: 'ADMIN' } });

    const network = await prisma.network.create({ data: { organizationId: orgId, userId: u.id, name: `Net ${Date.now()}` } });
    networkId = network.id;
    // sA: the site MEMBER and ADMIN are assigned to
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `HQ ${Date.now()}` } });
    siteId = site.id;
    // sB: a second site that MEMBER and ADMIN are NOT assigned to
    const siteB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `DC ${Date.now()}` } });
    sBId = siteB.id;
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: network.id, propertyId: site.id } });
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: network.id, propertyId: siteB.id } });

    // Team scoped to sA — both MEMBER and ADMIN are members of this team
    const team = await prisma.team.create({ data: { organizationId: orgId, name: 'Team A', creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: team.id, propertyId: siteId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: memberMembership.id } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: adminMembership.id } });

    // Device under sB — outside scope of MEMBER and ADMIN
    const devB = await prisma.device.create({
      data: { organizationId: orgId, userId: u.id, networkId, propertyId: sBId, name: `Dev B ${Date.now()}`, category: 'ROUTER' },
    });
    deviceUnderBId = devB.id;

    // Device under sA — in scope of MEMBER and ADMIN (used for F3 scoped write tests)
    const devA = await prisma.device.create({
      data: { organizationId: orgId, userId: u.id, networkId, propertyId: siteId, name: `Dev A ${Date.now()}`, category: 'SWITCH' },
    });
    deviceUnderAId = devA.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    // org delete cascades teams, teamMembers, teamProperties, orgMembers, devices, etc.
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [testEmail, memberEmail, adminEmail] } } });
    await app.close();
  });

  let deviceId: string;
  let deviceUnderAId: string;

  describe('GET /api/v1/devices', () => {
    it('returns 401 AUTH_002 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/devices');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_002');
    });

    it('returns 200 with the seeded sB device visible to owner (no scope filter)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // OWNER is unscoped — sees all devices including the sB device seeded in beforeAll
      const ids = (res.body.data.items as Array<{ id: string }>).map((d) => d.id);
      expect(ids).toContain(deviceUnderBId);
    });
  });

  describe('POST /api/v1/devices', () => {
    it('returns 400 GEN_001 for missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GEN_001');
    });

    it('returns 201 with DeviceDto on success', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'Test Router', category: 'ROUTER', networkId, propertyId: siteId });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Test Router');
      expect(res.body.data.version).toBe(1);
      deviceId = res.body.data.id;
    });

    it('returns 409 ORG_005 when name is already taken in org (case-insensitive)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: 'test router', category: 'SWITCH', networkId, propertyId: siteId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORG_005');
    });

    it('replays a create idempotently — same Idempotency-Key returns the original row, no duplicate', async () => {
      const key = 'e2e-idem-key-1';
      const body = { name: 'Idempotent AP', category: 'ACCESS_POINT', networkId, propertyId: siteId };

      const first = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .set('Idempotency-Key', key)
        .send(body);
      expect(first.status).toBe(201);
      const firstId = first.body.data.id;

      // Same key + same body. Without idempotency this would be 409 DEVICE_003
      // (name already taken); instead it returns the cached original response.
      const replay = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .set('Idempotency-Key', key)
        .send(body);
      expect(replay.status).toBe(201);
      expect(replay.body.data.id).toBe(firstId);

      // Exactly one device with that name exists — the replay created nothing.
      const list = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Cookie', sessionCookie);
      const matches = list.body.data.items.filter(
        (d: { name: string }) => d.name === 'Idempotent AP',
      );
      expect(matches).toHaveLength(1);
    });
  });

  describe('GET /api/v1/devices/:id', () => {
    it('returns 200 with DeviceDto for owned device', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(deviceId);
    });

    it('returns 404 DEVICE_001 for non-existent device', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/00000000-0000-0000-0000-000000000000')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DEVICE_001');
    });
  });

  describe('PATCH /api/v1/devices/:id', () => {
    it('returns 200 with updated DeviceDto', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'Updated notes' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Updated notes');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 SYNC_001 for version conflict', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'Stale update' }],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SYNC_001');
    });
  });

  describe('DELETE /api/v1/devices/:id', () => {
    it('returns 200 and removes the device', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns 404 DEVICE_001 after deletion', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${deviceId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('Audit ALS end-to-end', () => {
    it('writes a ChangeLog CREATE row with the session actor (ALS end-to-end)', async () => {
      const prisma = app.get(PrismaService);

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .send({ name: `AuditE2E ${Date.now()}`, category: 'ROUTER', networkId, propertyId: siteId })
        .expect(201);

      const newId = res.body.data.id;

      const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
      const logs = await prisma.changeLog.findMany({
        where: { entityType: 'Device', entityId: newId, action: 'CREATE' },
      });

      expect(logs).toHaveLength(1);
      // AuthGuard must have populated userId in the ALS store
      expect(logs[0].userId).toBe(u.id);
      // AuditContextMiddleware must have populated a real requestId (not the fallback 'unknown')
      expect(logs[0].requestId).not.toBe('unknown');
      expect(logs[0].requestId.length).toBeGreaterThan(0);
    });
  });

  describe('MEMBER read-only on devices', () => {
    it('MEMBER GET /api/v1/devices → 200 (read is allowed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Cookie', memberCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('MEMBER POST /api/v1/devices → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', memberCookie)
        .send({ name: 'Member Router', category: 'ROUTER', networkId, propertyId: siteId });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER PATCH /api/v1/devices/:id → 403 ORG_003 (service-level enforcement on real device)', async () => {
      // Use deviceUnderBId (exists org-wide, under sB). Service: org-wide find succeeds, then
      // assertCanConfigure(MEMBER, sBId) → ORG_003 regardless of which site the device is on.
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceUnderBId}`)
        .set('Cookie', memberCookie)
        .send({ baseVersion: 1, changes: [{ field: 'notes', oldValue: null, newValue: 'blocked' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER DELETE /api/v1/devices/:id → 403 ORG_003 (service-level enforcement on real device)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/devices/${deviceUnderBId}`)
        .set('Cookie', memberCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });
  });

  describe('F3 scoped enforcement', () => {
    it('MEMBER GET /api/v1/devices → sees sA device, does NOT see device under sB', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Cookie', memberCookie)
        .expect(200);

      const ids = (res.body.data.items as Array<{ id: string }>).map((d) => d.id);
      expect(ids).toContain(deviceUnderAId);
      expect(ids).not.toContain(deviceUnderBId);
    });

    it('MEMBER GET /api/v1/devices/:id for device under sB → 404 DEVICE_001', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${deviceUnderBId}`)
        .set('Cookie', memberCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DEVICE_001');
    });

    it('ADMIN (scoped to sA) PATCH device under sA → 200 (in-scope write allowed)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceUnderAId}`)
        .set('Cookie', adminCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'notes', oldValue: null, newValue: 'admin in-scope edit' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('admin in-scope edit');
    });

    it('ADMIN (scoped to sA) PATCH device under sB → 403 PERM_001', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceUnderBId}`)
        .set('Cookie', adminCookie)
        .send({ baseVersion: 1, changes: [{ field: 'notes', oldValue: null, newValue: 'admin out-of-scope' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_001');
    });

    it('MEMBER PATCH sA device → 403 ORG_003', async () => {
      // MEMBER is never allowed to write, regardless of scope
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${deviceUnderAId}`)
        .set('Cookie', memberCookie)
        .send({ baseVersion: 1, changes: [{ field: 'notes', oldValue: null, newValue: 'member write attempt' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('OWNER GET /api/v1/devices → sees both sA device and device under sB', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Cookie', sessionCookie)
        .expect(200);

      const ids = (res.body.data.items as Array<{ id: string }>).map((d) => d.id);
      expect(ids).toContain(deviceUnderAId);
      expect(ids).toContain(deviceUnderBId);
    });
  });

  describe('GET /api/v1/devices/name-suggestion', () => {
    let codedPropertyId: string;

    beforeAll(async () => {
      const prisma = app.get(PrismaService);
      const coded = await prisma.property.create({
        data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Coded ${Date.now()}`, code: 'hq' },
      });
      codedPropertyId = coded.id;
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/name-suggestion?propertyId=${codedPropertyId}&category=ROUTER`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_002');
    });

    it('returns null when org has no namingTemplate', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/name-suggestion?propertyId=${codedPropertyId}&category=ROUTER`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.suggestedName).toBeNull();
    });

    it('returns resolved name after namingTemplate is set on the org', async () => {
      // First get the current org version so we can send the correct baseVersion
      const orgRes = await request(app.getHttpServer())
        .get('/api/v1/organizations/me')
        .set('Cookie', sessionCookie)
        .expect(200);
      const currentVersion = orgRes.body.data.version as number;

      // PATCH the org to set the namingTemplate
      const patchRes = await request(app.getHttpServer())
        .patch('/api/v1/organizations/me')
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: currentVersion,
          changes: [{ field: 'namingTemplate', oldValue: null, newValue: '{site}-{role}-{seq}' }],
        });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.namingTemplate).toBe('{site}-{role}-{seq}');

      // Now get a name suggestion — site code 'hq', ROUTER → role 'rtr', no existing devices → seq '01'
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/name-suggestion?propertyId=${codedPropertyId}&category=ROUTER`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.suggestedName).toBe('hq-rtr-01');
    });

    it('returns 400 GEN_001 for an invalid category', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/name-suggestion?propertyId=${codedPropertyId}&category=NOT_A_CATEGORY`)
        .set('Cookie', sessionCookie);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('GEN_001');
    });
  });
});
