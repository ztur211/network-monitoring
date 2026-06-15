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
  let memberCookie: string;
  let adminCookie: string;
  /** A network seeded in beforeAll — used for MEMBER-write and ADMIN-scope tests. */
  let scopeTestNetworkId: string;
  let orgId: string;
  /** sA: site ADMIN (scoped to sA only) is assigned to via a Team. */
  let sAId: string;
  /** sB: site ADMIN is NOT assigned to. */
  let sBId: string;
  /**
   * A network with NO charters but a device placed under sB.
   * Used to prove device-footprint coverage enforcement (PERM_004).
   */
  let footprintNetworkId: string;
  const testEmail = `e2e-networks-${Date.now()}@example.com`;
  const memberEmail = `e2e-networks-member-${Date.now()}@example.com`;
  const adminEmail = `e2e-networks-admin-${Date.now()}@example.com`;

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
        .send({ email: testEmail, password: 'Password123!', name: 'Networks Test User' }),
    );

    memberCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: memberEmail, password: 'Password123!', name: 'Networks Member User' }),
    );

    adminCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminEmail, password: 'Password123!', name: 'Networks Admin User' }),
    );

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E Networks ${Date.now()}` } });
    orgId = org.id;

    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });
    const memberMembership = await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });
    const adminMembership = await prisma.organizationMember.create({ data: { userId: adminUser.id, organizationId: orgId, role: 'ADMIN' } });

    // sA: the site ADMIN is scoped to via a Team
    const siteA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Site A ${Date.now()}` } });
    sAId = siteA.id;
    // sB: a second site ADMIN is NOT assigned to
    const siteB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Site B ${Date.now()}` } });
    sBId = siteB.id;

    // Seed a network chartered to BOTH sA and sB — used for MEMBER-write and ADMIN partial-scope tests
    const scopeNet = await prisma.network.create({
      data: { organizationId: orgId, userId: u.id, name: `Scope Test Net ${Date.now()}` },
    });
    scopeTestNetworkId = scopeNet.id;
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: scopeNet.id, propertyId: sAId } });
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId: scopeNet.id, propertyId: sBId } });

    // Team scoped to sA only — ADMIN is a member of this team
    const team = await prisma.team.create({ data: { organizationId: orgId, name: 'Team A', creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: team.id, propertyId: sAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: adminMembership.id } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: memberMembership.id } });

    // Charter-less network with one device placed under sB — proves device-footprint coverage enforcement
    const footprintNet = await prisma.network.create({
      data: { organizationId: orgId, userId: u.id, name: `Footprint Test Net ${Date.now()}` },
    });
    footprintNetworkId = footprintNet.id;
    await prisma.device.create({
      data: {
        organizationId: orgId,
        networkId: footprintNet.id,
        propertyId: sBId,
        name: 'Test Switch',
        category: 'SWITCH',
      },
    });
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    // org delete cascades teams, teamMembers, teamProperties, orgMembers, networks, networkProperties, etc.
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [testEmail, memberEmail, adminEmail] } } });
    await app.close();
  });

  describe('POST /api/v1/networks', () => {
    it('returns 201 with NetworkDetail (including homePublicIp) on first create', async () => {
      // scopeTestNetworkId already exists; OWNER creates a second one — but MAX=1 so we need
      // to use a fresh org for this test. Actually: scopeTestNetworkId was created via Prisma
      // directly (bypassing the 1-per-org check in the service). The OWNER POST should hit
      // NETWORK_001 because scopeTestNetworkId already exists.
      // Instead, we test create with the other-user pattern (ephemeral org with 0 networks).
      const otherEmail = `e2e-networks-create-${Date.now()}@example.com`;
      const otherSignUp = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: otherEmail, password: 'Password123!', name: 'Creator' });
      const otherCookie = pickCookie(otherSignUp);

      const prisma = app.get(PrismaService);
      const otherUser = await prisma.user.findUniqueOrThrow({ where: { email: otherEmail } });
      const otherOrg = await prisma.organization.create({ data: { name: `E2E Networks Create ${Date.now()}` } });
      await prisma.organizationMember.create({ data: { userId: otherUser.id, organizationId: otherOrg.id, role: 'OWNER' } });

      const res = await request(app.getHttpServer())
        .post('/api/v1/networks')
        .set('Cookie', otherCookie)
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

      // cleanup — delete created network first, then org
      await prisma.network.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
      await prisma.user.deleteMany({ where: { email: otherEmail } });
    });

    it('returns 409 NETWORK_001 NETWORK_LIMIT_EXCEEDED when org already has 1 network', async () => {
      // scopeTestNetworkId counts as the org's 1 network
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

      const prisma = app.get(PrismaService);
      const otherUser = await prisma.user.findUniqueOrThrow({ where: { email: otherEmail } });
      const otherOrg = await prisma.organization.create({ data: { name: `E2E Networks Other ${Date.now()}` } });
      await prisma.organizationMember.create({ data: { userId: otherUser.id, organizationId: otherOrg.id, role: 'OWNER' } });

      const res = await request(app.getHttpServer())
        .post('/api/v1/networks')
        .set('Cookie', otherCookie)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GEN_001');

      await prisma.organizationMember.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
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
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).not.toHaveProperty('homePublicIp');
    });
  });

  describe('GET /api/v1/networks/:id', () => {
    it('returns 200 with NetworkDetail including homePublicIp', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('homePublicIp');
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
    it('OWNER rename returns 200 with incremented version', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'isp', oldValue: null, newValue: 'Comcast' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.isp).toBe('Comcast');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 SYNC_001 on version mismatch', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', sessionCookie)
        .send({
          baseVersion: 1,
          changes: [{ field: 'isp', oldValue: 'Comcast', newValue: 'AT&T' }],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SYNC_001');
    });
  });

  describe('POST /api/v1/networks/:id/set-home-ip', () => {
    it('OWNER returns 200 with NetworkDetail; homePublicIp reflects request IP', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/networks/${scopeTestNetworkId}/set-home-ip`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(typeof res.body.data.homePublicIp).toBe('string');
      expect(res.body.data.homePublicIp.length).toBeGreaterThan(0);
    });

    it('returns 404 NETWORK_002 when target network does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/networks/00000000-0000-0000-0000-000000000000/set-home-ip')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NETWORK_002');
    });
  });

  describe('DELETE /api/v1/networks/:id', () => {
    it('returns 404 NETWORK_002 when deleting non-existent network', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/networks/00000000-0000-0000-0000-000000000000')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NETWORK_002');
    });
  });

  describe('MEMBER read-only on networks', () => {
    it('MEMBER GET /api/v1/networks → 200 (read is allowed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/networks')
        .set('Cookie', memberCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('MEMBER POST /api/v1/networks → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/networks')
        .set('Cookie', memberCookie)
        .send({ name: 'Member Network' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER PATCH /api/v1/networks/:id → 403 ORG_003 (real network, service-level enforcement)', async () => {
      // Get current version first
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', sessionCookie);
      const currentVersion = getRes.body.data.version as number;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', memberCookie)
        .send({ baseVersion: currentVersion, changes: [{ field: 'isp', oldValue: null, newValue: 'blocked' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER POST /api/v1/networks/:id/set-home-ip → 403 ORG_003 (real network, service-level enforcement)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/networks/${scopeTestNetworkId}/set-home-ip`)
        .set('Cookie', memberCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER DELETE /api/v1/networks/:id → 403 ORG_003 (real network, service-level enforcement)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', memberCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });
  });

  describe('F3 scoped enforcement', () => {
    /**
     * The org's network (scopeTestNetworkId) is chartered to BOTH sA and sB.
     * ADMIN is scoped to sA only (via Team A → sA).
     * MEMBER is also scoped to sA only.
     * OWNER is unscoped.
     *
     * Visibility rule: a network is visible if ANY charter or placed device is in scope.
     * Coverage rule for writes: ADMIN must cover EVERY chartered site → else PERM_004.
     */

    it('MEMBER GET /api/v1/networks → 200 (network visible because sA charter is in scope)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/networks')
        .set('Cookie', memberCookie)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((n) => n.id);
      expect(ids).toContain(scopeTestNetworkId);
    });

    it('ADMIN (scoped sA only) GET /api/v1/networks → 200 (visible via sA charter)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/networks')
        .set('Cookie', adminCookie)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((n) => n.id);
      expect(ids).toContain(scopeTestNetworkId);
    });

    it('ADMIN (scoped sA only) GET /api/v1/networks/:id → 200 (visible via sA charter)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(scopeTestNetworkId);
    });

    it('ADMIN (scoped sA only) PATCH → 403 PERM_004 (network has sB charter not covered)', async () => {
      // Get current version from OWNER
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', sessionCookie);
      const currentVersion = getRes.body.data.version as number;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', adminCookie)
        .send({ baseVersion: currentVersion, changes: [{ field: 'isp', oldValue: 'Comcast', newValue: 'Verizon' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_004');
    });

    it('ADMIN (scoped sA only) set-home-ip → 403 PERM_004', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/networks/${scopeTestNetworkId}/set-home-ip`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_004');
    });

    it('ADMIN (scoped sA only) DELETE → 403 PERM_004', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_004');
    });

    it('OWNER PATCH → 200 (OWNER covers all sites, unscoped)', async () => {
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', sessionCookie);
      const currentVersion = getRes.body.data.version as number;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${scopeTestNetworkId}`)
        .set('Cookie', sessionCookie)
        .send({ baseVersion: currentVersion, changes: [{ field: 'name', oldValue: 'Scope Test Net', newValue: 'Owner Renamed' }] });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(currentVersion + 1);
    });

    it('OWNER GET /api/v1/networks → sees the network (unscoped)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/networks')
        .set('Cookie', sessionCookie)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((n) => n.id);
      expect(ids).toContain(scopeTestNetworkId);
    });
  });

  describe('F3 device-footprint coverage enforcement', () => {
    /**
     * footprintNetworkId has NO charter rows but has one device placed under sB.
     * ADMIN is scoped to sA only → the device footprint (sB) is outside ADMIN scope
     * → write must return 403 PERM_004.
     * OWNER → 200 (unscoped, all sites covered).
     */

    it('ADMIN (scoped sA only) PATCH charter-less network with device under sB → 403 PERM_004', async () => {
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/networks/${footprintNetworkId}`)
        .set('Cookie', sessionCookie);
      const currentVersion = getRes.body.data.version as number;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${footprintNetworkId}`)
        .set('Cookie', adminCookie)
        .send({ baseVersion: currentVersion, changes: [{ field: 'name', oldValue: 'Footprint Test Net', newValue: 'Hijacked' }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERM_004');
    });

    it('OWNER PATCH charter-less network with device under sB → 200 (unscoped)', async () => {
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/networks/${footprintNetworkId}`)
        .set('Cookie', sessionCookie);
      const currentVersion = getRes.body.data.version as number;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/networks/${footprintNetworkId}`)
        .set('Cookie', sessionCookie)
        .send({ baseVersion: currentVersion, changes: [{ field: 'name', oldValue: 'Footprint Test Net', newValue: 'Owner Rename OK' }] });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(currentVersion + 1);
    });
  });
});
