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
  let sessionCookie: string;  // OWNER
  let memberCookie: string;   // MEMBER (scoped to sA via team)
  let adminCookie: string;    // ADMIN (scoped to sA via team)
  let circuitId: string;
  let orgId: string;
  let sAId: string;
  let sBId: string;
  let networkId: string;
  let circAId: string;  // circuit linked to dA (under sA)
  let circBId: string;  // circuit linked to dB (under sB)

  const testEmail = `e2e-circuits-${Date.now()}@example.com`;
  const memberEmail = `e2e-circuits-member-${Date.now()}@example.com`;
  const adminEmail = `e2e-circuits-admin-${Date.now()}@example.com`;

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

    adminCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminEmail, password: 'Password123!', name: 'Circuits Admin User' }),
    );

    const prisma = app.get(PrismaService);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: testEmail } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E Circuits ${Date.now()}` } });
    orgId = org.id;

    await prisma.organizationMember.create({ data: { userId: u.id, organizationId: orgId, role: 'OWNER' } });
    const memberMembership = await prisma.organizationMember.create({ data: { userId: member.id, organizationId: orgId, role: 'MEMBER' } });
    const adminMembership = await prisma.organizationMember.create({ data: { userId: admin.id, organizationId: orgId, role: 'ADMIN' } });

    // sA: the site MEMBER and ADMIN are scoped to via team
    const siteA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `HQ ${Date.now()}` } });
    sAId = siteA.id;
    // sB: a second site outside the scope of MEMBER and ADMIN
    const siteB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `DC ${Date.now()}` } });
    sBId = siteB.id;

    const network = await prisma.network.create({ data: { organizationId: orgId, userId: u.id, name: `Net ${Date.now()}` } });
    networkId = network.id;
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId, propertyId: sAId } });
    await prisma.networkProperty.create({ data: { organizationId: orgId, networkId, propertyId: sBId } });

    // Team scoped to sA — both MEMBER and ADMIN are members
    const team = await prisma.team.create({ data: { organizationId: orgId, name: 'Team A', creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: team.id, propertyId: sAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: memberMembership.id } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: adminMembership.id } });

    // Devices: dA under sA, dB under sB
    const dA = await prisma.device.create({
      data: { organizationId: orgId, userId: u.id, networkId, propertyId: sAId, name: `dA ${Date.now()}`, category: 'ROUTER' },
    });
    const dB = await prisma.device.create({
      data: { organizationId: orgId, userId: u.id, networkId, propertyId: sBId, name: `dB ${Date.now()}`, category: 'SWITCH' },
    });

    // Circuits: circA linked to dA, circB linked to dB
    const cA = await prisma.circuit.create({
      data: { organizationId: orgId, userId: u.id, ispName: 'ISP-A', serviceType: 'Fiber', deviceId: dA.id },
    });
    circAId = cA.id;
    const cB = await prisma.circuit.create({
      data: { organizationId: orgId, userId: u.id, ispName: 'ISP-B', serviceType: 'Cable', deviceId: dB.id },
    });
    circBId = cB.id;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    // org delete cascades all child records
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [testEmail, memberEmail, adminEmail] } } });
    await app.close();
  });

  describe('POST /api/v1/circuits', () => {
    it('returns 201 with CircuitDto on success (OWNER, device-less)', async () => {
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

    it('MEMBER POST /api/v1/circuits → 403 ORG_003 (device-less → __nosite__)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/circuits')
        .set('Cookie', memberCookie)
        .send({ ispName: 'Member ISP', serviceType: 'Fiber' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER PATCH /api/v1/circuits/:circA → 403 ORG_003 (MEMBER never writes)', async () => {
      // circA is in sA (in scope for MEMBER's team), but MEMBER role never writes
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/circuits/${circAId}`)
        .set('Cookie', memberCookie);
      const version = getRes.body.data?.version ?? 1;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/circuits/${circAId}`)
        .set('Cookie', memberCookie)
        .send({ baseVersion: version, changes: [{ field: 'bandwidth', oldValue: null, newValue: 500 }] });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });

    it('MEMBER DELETE /api/v1/circuits/:circA → 403 ORG_003', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/circuits/${circAId}`)
        .set('Cookie', memberCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ORG_003');
    });
  });

  describe('F3 scoped enforcement', () => {
    describe('ADMIN scoped to sA only', () => {
      it('GET /api/v1/circuits → includes circA (in sA), excludes circB (in sB)', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/circuits')
          .set('Cookie', adminCookie)
          .expect(200);

        const ids = (res.body.data.items as Array<{ id: string }>).map((c) => c.id);
        expect(ids).toContain(circAId);
        expect(ids).not.toContain(circBId);
      });

      it('GET /api/v1/circuits/:circA → 200 (circA is in sA, in scope)', async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/circuits/${circAId}`)
          .set('Cookie', adminCookie);

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(circAId);
      });

      it('GET /api/v1/circuits/:circB → 404 CIRCUIT_001 (circB is outside sA scope)', async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/circuits/${circBId}`)
          .set('Cookie', adminCookie);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('CIRCUIT_001');
      });

      it('PATCH /api/v1/circuits/:circA → 200 (in-scope write allowed)', async () => {
        // Get current version first
        const getRes = await request(app.getHttpServer())
          .get(`/api/v1/circuits/${circAId}`)
          .set('Cookie', sessionCookie);
        const version = getRes.body.data.version as number;

        const res = await request(app.getHttpServer())
          .patch(`/api/v1/circuits/${circAId}`)
          .set('Cookie', adminCookie)
          .send({ baseVersion: version, changes: [{ field: 'notes', oldValue: null, newValue: 'admin in-scope edit' }] });

        expect(res.status).toBe(200);
        expect(res.body.data.notes).toBe('admin in-scope edit');
      });

      it('PATCH /api/v1/circuits/:circB → 403 PERM_001 (circB is outside sA scope)', async () => {
        // Write path: org-wide lookup → found, then assertCanConfigure(ADMIN, sBId) → PERM_001
        const getRes = await request(app.getHttpServer())
          .get(`/api/v1/circuits/${circBId}`)
          .set('Cookie', sessionCookie);
        const version = getRes.body.data.version as number;

        const res = await request(app.getHttpServer())
          .patch(`/api/v1/circuits/${circBId}`)
          .set('Cookie', adminCookie)
          .send({ baseVersion: version, changes: [{ field: 'notes', oldValue: null, newValue: 'admin out-of-scope' }] });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PERM_001');
      });
    });

    describe('MEMBER scoped to sA', () => {
      it('GET /api/v1/circuits → includes circA, excludes circB', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/circuits')
          .set('Cookie', memberCookie)
          .expect(200);

        const ids = (res.body.data.items as Array<{ id: string }>).map((c) => c.id);
        expect(ids).toContain(circAId);
        expect(ids).not.toContain(circBId);
      });

      it('PATCH /api/v1/circuits/:circA → 403 ORG_003 (MEMBER never writes, even in scope)', async () => {
        const getRes = await request(app.getHttpServer())
          .get(`/api/v1/circuits/${circAId}`)
          .set('Cookie', sessionCookie);
        const version = getRes.body.data.version as number;

        const res = await request(app.getHttpServer())
          .patch(`/api/v1/circuits/${circAId}`)
          .set('Cookie', memberCookie)
          .send({ baseVersion: version, changes: [{ field: 'notes', oldValue: null, newValue: 'member write attempt' }] });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ORG_003');
      });
    });

    describe('OWNER (unscoped)', () => {
      it('GET /api/v1/circuits → sees both circA and circB', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/circuits')
          .set('Cookie', sessionCookie)
          .expect(200);

        const ids = (res.body.data.items as Array<{ id: string }>).map((c) => c.id);
        expect(ids).toContain(circAId);
        expect(ids).toContain(circBId);
      });
    });

    describe('Device-less circuits (OWNER-only)', () => {
      it('OWNER can create a device-less circuit', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/circuits')
          .set('Cookie', sessionCookie)
          .send({ ispName: 'NoDevice ISP', serviceType: 'MPLS' });

        expect(res.status).toBe(201);
      });

      it('ADMIN cannot create a device-less circuit → 403 PERM_001 (__nosite__ outside scope)', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/circuits')
          .set('Cookie', adminCookie)
          .send({ ispName: 'Admin NoDevice ISP', serviceType: 'MPLS' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PERM_001');
      });

      it('MEMBER cannot create a device-less circuit → 403 ORG_003', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/circuits')
          .set('Cookie', memberCookie)
          .send({ ispName: 'Member NoDevice ISP', serviceType: 'MPLS' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ORG_003');
      });
    });
  });
});
