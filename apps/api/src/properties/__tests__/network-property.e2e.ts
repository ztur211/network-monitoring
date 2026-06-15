import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/networks/:networkId/properties (charter) endpoints.
 * Also covers ContainmentService's PROP_007 / PROP_008 enforcement and
 * F3 site-scoped enforcement (PERM_004 / ORG_003).
 * Requires running test database and Redis.
 */
describe('NetworkProperty (charters) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  /** ADMIN scoped to sA only — does NOT cover sB */
  let adminSaOnlyCookie: string;
  /** MEMBER — read-only role */
  let memberCookie: string;
  let orgId: string;
  let networkId: string;
  let siteId: string;
  let unrelatedSiteId: string;
  /** sA — the site the scoped ADMIN covers */
  let sAId: string;
  /** sB — the site the scoped ADMIN does NOT cover */
  let sBId: string;
  /** networkId for the F3 enforcement tests (pre-chartered to sA + sB) */
  let f3NetworkId: string;

  const ownerEmail = `e2e-charter-owner-${Date.now()}@x.com`;
  const adminSaOnlyEmail = `e2e-charter-admin-sa-${Date.now()}@x.com`;
  const memberEmail = `e2e-charter-member-${Date.now()}@x.com`;
  const password = 'Password123!';

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    ownerCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: ownerEmail, password, name: 'Owner' }),
    );
    adminSaOnlyCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: adminSaOnlyEmail, password, name: 'AdminSA' }),
    );
    memberCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: memberEmail, password, name: 'Member' }),
    );

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const adminSaUser = await prisma.user.findUniqueOrThrow({ where: { email: adminSaOnlyEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E Charter ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: 'OWNER' } });
    const adminSaMembership = await prisma.organizationMember.create({ data: { userId: adminSaUser.id, organizationId: orgId, role: 'ADMIN' } });
    await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });

    const network = await prisma.network.create({ data: { organizationId: orgId, userId: owner.id, name: `Net ${Date.now()}` } });
    networkId = network.id;

    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `HQ ${Date.now()}` } });
    siteId = site.id;

    const unrelatedSite = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Remote ${Date.now()}` } });
    unrelatedSiteId = unrelatedSite.id;

    // F3: create sA + sB, a network pre-chartered to both, and an ADMIN scoped to sA only
    const sA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `SA-${Date.now()}` } });
    sAId = sA.id;
    const sB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `SB-${Date.now()}` } });
    sBId = sB.id;

    const f3Network = await prisma.network.create({ data: { organizationId: orgId, userId: owner.id, name: `F3Net ${Date.now()}` } });
    f3NetworkId = f3Network.id;
    // Pre-charter f3Network to sA + sB so enforcement tests have something to cover
    await prisma.networkProperty.createMany({
      data: [
        { organizationId: orgId, networkId: f3NetworkId, propertyId: sAId },
        { organizationId: orgId, networkId: f3NetworkId, propertyId: sBId },
      ],
    });

    // Scope adminSaOnly to sA via a team
    const team = await prisma.team.create({ data: { organizationId: orgId, name: `SA-Team-${Date.now()}`, creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: team.id, propertyId: sAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: adminSaMembership.id } });
  });

  afterAll(async () => {
    await prisma.device.deleteMany({ where: { organizationId: orgId } });
    await prisma.networkProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.network.deleteMany({ where: { organizationId: orgId } });
    // Teams and their memberships/properties must be removed before properties (FK constraint)
    await prisma.teamMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.teamProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.team.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, adminSaOnlyEmail, memberEmail] } } });
    await app.close();
  });

  describe('POST /api/v1/networks/:networkId/properties', () => {
    it('OWNER charters a network to a SITE → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/networks/${networkId}/properties`)
        .set('Cookie', ownerCookie)
        .send({ propertyId: siteId })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.networkId).toBe(networkId);
      expect(res.body.data.propertyId).toBe(siteId);
    });

    it('duplicate charter → 409 PROP_006', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/networks/${networkId}/properties`)
        .set('Cookie', ownerCookie)
        .send({ propertyId: siteId })
        .expect(409);

      expect(res.body.error.code).toBe('PROP_006');
    });
  });

  describe('ContainmentService.assertDevicePlacement', () => {
    it('placing a device under the chartered site succeeds → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', ownerCookie)
        .send({ name: `Charter Device ${Date.now()}`, category: 'ROUTER', networkId, propertyId: siteId })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.propertyId).toBe(siteId);
    });

    it('placing a device under an UNRELATED site (no charter) → 422 PROP_007', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Cookie', ownerCookie)
        .send({ name: `Unchartered Device ${Date.now()}`, category: 'SWITCH', networkId, propertyId: unrelatedSiteId })
        .expect(422);

      expect(res.body.error.code).toBe('PROP_007');
    });
  });

  describe('DELETE /api/v1/networks/:networkId/properties/:propertyId', () => {
    it('removing a charter that still covers a placed device → 409 PROP_008', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/networks/${networkId}/properties/${siteId}`)
        .set('Cookie', ownerCookie)
        .expect(409);

      expect(res.body.error.code).toBe('PROP_008');
    });

    it('removing a charter with no placed devices succeeds → 200', async () => {
      // Charter the unrelated site first, then remove it (no devices placed there)
      await request(app.getHttpServer())
        .post(`/api/v1/networks/${networkId}/properties`)
        .set('Cookie', ownerCookie)
        .send({ propertyId: unrelatedSiteId })
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/networks/${networkId}/properties/${unrelatedSiteId}`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });
  });

  describe('GET /api/v1/networks/:networkId/properties', () => {
    it('lists current charters for a network → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/networks/${networkId}/properties`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const charter = (res.body.data as Array<{ propertyId: string }>).find((c) => c.propertyId === siteId);
      expect(charter).toBeDefined();
    });
  });

  describe('F3 scoped enforcement', () => {
    describe('POST add charter — PERM_004 when ADMIN cannot cover existing charters', () => {
      it('ADMIN scoped to sA only cannot add a charter (sB not covered) → 403 PERM_004', async () => {
        // f3Network is already chartered to sA + sB; ADMIN only covers sA
        const sC = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `SC-${Date.now()}` } });
        const res = await request(app.getHttpServer())
          .post(`/api/v1/networks/${f3NetworkId}/properties`)
          .set('Cookie', adminSaOnlyCookie)
          .send({ propertyId: sC.id })
          .expect(403);

        expect(res.body.error.code).toBe('PERM_004');
        // cleanup
        await prisma.property.delete({ where: { id: sC.id } });
      });
    });

    describe('DELETE remove charter — PERM_004 when ADMIN cannot cover existing charters', () => {
      it('ADMIN scoped to sA only cannot remove any charter (sB not covered) → 403 PERM_004', async () => {
        const res = await request(app.getHttpServer())
          .delete(`/api/v1/networks/${f3NetworkId}/properties/${sAId}`)
          .set('Cookie', adminSaOnlyCookie)
          .expect(403);

        expect(res.body.error.code).toBe('PERM_004');
      });
    });

    describe('POST add charter — ORG_003 when MEMBER attempts mutation', () => {
      it('MEMBER add charter → 403 ORG_003', async () => {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/networks/${f3NetworkId}/properties`)
          .set('Cookie', memberCookie)
          .send({ propertyId: sAId })
          .expect(403);

        expect(res.body.error.code).toBe('ORG_003');
      });
    });

    describe('DELETE remove charter — ORG_003 when MEMBER attempts mutation', () => {
      it('MEMBER remove charter → 403 ORG_003', async () => {
        const res = await request(app.getHttpServer())
          .delete(`/api/v1/networks/${f3NetworkId}/properties/${sAId}`)
          .set('Cookie', memberCookie)
          .expect(403);

        expect(res.body.error.code).toBe('ORG_003');
      });
    });

    describe('GET list charters — scoped reads', () => {
      it('OWNER sees all charters (sA + sB) → 200', async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/networks/${f3NetworkId}/properties`)
          .set('Cookie', ownerCookie)
          .expect(200);

        expect(res.body.success).toBe(true);
        const ids = (res.body.data as Array<{ propertyId: string }>).map((c) => c.propertyId);
        expect(ids).toContain(sAId);
        expect(ids).toContain(sBId);
      });

      it('ADMIN scoped to sA only sees only sA charter → 200', async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/networks/${f3NetworkId}/properties`)
          .set('Cookie', adminSaOnlyCookie)
          .expect(200);

        expect(res.body.success).toBe(true);
        const ids = (res.body.data as Array<{ propertyId: string }>).map((c) => c.propertyId);
        expect(ids).toContain(sAId);
        expect(ids).not.toContain(sBId);
      });
    });

    describe('OWNER can add and remove charters on f3Network', () => {
      let extraSiteId: string;

      beforeAll(async () => {
        const extraSite = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Extra-${Date.now()}` } });
        extraSiteId = extraSite.id;
      });

      afterAll(async () => {
        // clean up extra site (charter already removed by the remove test)
        await prisma.property.deleteMany({ where: { id: extraSiteId } });
      });

      it('OWNER adds a third charter → 201', async () => {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/networks/${f3NetworkId}/properties`)
          .set('Cookie', ownerCookie)
          .send({ propertyId: extraSiteId })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.propertyId).toBe(extraSiteId);
      });

      it('OWNER removes the extra charter → 200', async () => {
        const res = await request(app.getHttpServer())
          .delete(`/api/v1/networks/${f3NetworkId}/properties/${extraSiteId}`)
          .set('Cookie', ownerCookie)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeNull();
      });
    });
  });
});
