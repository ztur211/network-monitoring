import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Properties (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  let memberCookie: string;
  let adminCookie: string;
  let orgId: string;

  const ownerEmail = `e2e-prop-owner-${Date.now()}@x.com`;
  const memberEmail = `e2e-prop-member-${Date.now()}@x.com`;
  const adminEmail = `e2e-prop-admin-${Date.now()}@x.com`;
  const password = 'Password123!';

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

  /** sA: the site ADMIN is scoped to (via Team). sB: an unrelated site. */
  let sAId: string;
  let sBId: string;

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
    memberCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: memberEmail, password, name: 'Member' }),
    );
    adminCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: adminEmail, password, name: 'Admin' }),
    );

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E Properties ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: 'OWNER' } });
    const memberMembership = await prisma.organizationMember.create({ data: { userId: member.id, organizationId: orgId, role: 'MEMBER' } });
    const adminMembership = await prisma.organizationMember.create({ data: { userId: admin.id, organizationId: orgId, role: 'ADMIN' } });

    // sA: the site we will assign ADMIN (and MEMBER for scope check) to via a Team
    const sA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Site A ${Date.now()}` } });
    sAId = sA.id;
    // sB: an unrelated site ADMIN is NOT assigned to
    const sB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Site B ${Date.now()}` } });
    sBId = sB.id;

    // Team scoped to sA — ADMIN and MEMBER are members of this team
    const team = await prisma.team.create({ data: { organizationId: orgId, name: 'Team A', creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: team.id, propertyId: sAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: adminMembership.id } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: team.id, memberId: memberMembership.id } });
  });

  afterAll(async () => {
    // org delete cascades teams, teamMembers, teamProperties, orgMembers, properties, etc.
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail, adminEmail] } } });
    await app.close();
  });

  let siteId: string;
  let buildingId: string;

  it('OWNER creates a SITE → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', ownerCookie)
      .send({ type: 'SITE', name: 'HQ', code: 'hq' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('SITE');
    siteId = res.body.data.id as string;
  });

  it('OWNER creates a BUILDING under SITE → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', ownerCookie)
      .send({ type: 'BUILDING', name: 'Tower A', parentId: siteId })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.parentId).toBe(siteId);
    buildingId = res.body.data.id as string;
  });

  it('illegal nesting: FLOOR directly under SITE → 422 PROP_002', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', ownerCookie)
      .send({ type: 'FLOOR', name: 'Floor 1', parentId: siteId })
      .expect(422);

    expect(res.body.error.code).toBe('PROP_002');
  });

  it('duplicate sibling name (case-insensitive) → 409 PROP_003', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', ownerCookie)
      .send({ type: 'BUILDING', name: 'tower a', parentId: siteId })
      .expect(409);

    expect(res.body.error.code).toBe('PROP_003');
  });

  it('delete SITE with child → 409 PROP_004', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/properties/${siteId}`)
      .set('Cookie', ownerCookie)
      .expect(409);

    expect(res.body.error.code).toBe('PROP_004');
  });

  it('MEMBER GET /properties → 200 (sees only assigned sites)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/properties')
      .set('Cookie', memberCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // MEMBER is scoped to sA — sB and the HQ site (no team assignment) are not visible
    const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(sAId);
    expect(ids).not.toContain(sBId);
  });

  it('MEMBER POST /properties → 403 ORG_003', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/properties')
      .set('Cookie', memberCookie)
      .send({ type: 'SITE', name: 'Nope' })
      .expect(403);

    expect(res.body.error.code).toBe('ORG_003');
  });

  it('cleanup: delete building then site → 200 each', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${buildingId}`)
      .set('Cookie', ownerCookie)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${siteId}`)
      .set('Cookie', ownerCookie)
      .expect(200);
  });

  it('cannot delete a site that is assigned to a team → 409 PERM_005; succeeds after unassigning', async () => {
    // Create a standalone SITE with no children/devices/charters
    const site = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Assigned ${Date.now()}` } });
    const team = await prisma.team.create({ data: { organizationId: orgId, name: `AsgTeam ${Date.now()}`, creatorMemberId: null } });
    const tp = await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: team.id, propertyId: site.id } });

    const denied = await request(app.getHttpServer())
      .delete(`/api/v1/properties/${site.id}`).set('Cookie', ownerCookie).expect(409);
    expect(denied.body.error.code).toBe('PERM_005');

    await prisma.teamProperty.delete({ where: { id: tp.id } });
    await request(app.getHttpServer())
      .delete(`/api/v1/properties/${site.id}`).set('Cookie', ownerCookie).expect(200);
    await prisma.team.delete({ where: { id: team.id } });
  });

  describe('F3 scoped enforcement', () => {
    it('ADMIN (scoped to sA) GET /properties → sees sA, does NOT see sB', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/properties')
        .set('Cookie', adminCookie)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(sAId);
      expect(ids).not.toContain(sBId);
    });

    it('ADMIN (scoped to sA) GET /properties/:id for sB → 404 PROP_001 (out-of-scope invisible)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/properties/${sBId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PROP_001');
    });

    it('ADMIN (scoped to sA) POST sub-site under sA → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Cookie', adminCookie)
        .send({ type: 'BUILDING', name: `Admin Building ${Date.now()}`, parentId: sAId })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.parentId).toBe(sAId);

      // Clean up the building created in this test
      await request(app.getHttpServer())
        .delete(`/api/v1/properties/${res.body.data.id}`)
        .set('Cookie', ownerCookie)
        .expect(200);
    });

    it('ADMIN (scoped to sA) POST top-level SITE (parentId: null) → 403 PERM_001', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Cookie', adminCookie)
        .send({ type: 'SITE', name: `Admin Top Level ${Date.now()}` })
        .expect(403);

      expect(res.body.error.code).toBe('PERM_001');
    });

    it('OWNER POST top-level SITE → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/properties')
        .set('Cookie', ownerCookie)
        .send({ type: 'SITE', name: `Owner Top Level ${Date.now()}` })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.parentId).toBeNull();

      // Clean up
      await request(app.getHttpServer())
        .delete(`/api/v1/properties/${res.body.data.id}`)
        .set('Cookie', ownerCookie)
        .expect(200);
    });

    it('OWNER GET /properties → sees both sA and sB (unscoped)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/properties')
        .set('Cookie', ownerCookie)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(sAId);
      expect(ids).toContain(sBId);
    });
  });
});
