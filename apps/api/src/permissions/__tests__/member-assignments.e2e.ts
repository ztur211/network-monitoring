import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('MemberAssignments (direct site grants + in-scope-slice access view) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerCookie: string;
  let adminCookie: string;
  let memberCookie: string;

  let orgId: string;
  let ownerMemberId: string;
  let adminMemberId: string;
  let memberMemberId: string;

  let sAId: string;
  let sBId: string;

  const ts = Date.now();
  const ownerEmail = `e2e-masgn-owner-${ts}@x.com`;
  const adminEmail = `e2e-masgn-admin-${ts}@x.com`;
  const memberEmail = `e2e-masgn-member-${ts}@x.com`;
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

    // Sign up users
    ownerCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: ownerEmail, password, name: 'Owner' }),
    );
    adminCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: adminEmail, password, name: 'Admin' }),
    );
    memberCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: memberEmail, password, name: 'Member' }),
    );

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E MemberAssign ${ts}` } });
    orgId = org.id;

    const ownerMember = await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    ownerMemberId = ownerMember.id;
    const adminMember = await prisma.organizationMember.create({ data: { userId: adminUser.id, organizationId: orgId, role: 'ADMIN' } });
    adminMemberId = adminMember.id;
    const memberMember = await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });
    memberMemberId = memberMember.id;

    // Create two sites
    const sA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Site A ${ts}` } });
    sAId = sA.id;
    const sB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Site B ${ts}` } });
    sBId = sB.id;

    // Scope ADMIN to sA via a team
    const adminScopeTeam = await prisma.team.create({ data: { organizationId: orgId, name: `Admin Scope ${ts}`, creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: adminScopeTeam.id, propertyId: sAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: adminScopeTeam.id, memberId: adminMemberId } });
  });

  afterAll(async () => {
    // Cascade-safe cleanup: memberProperty → teamMember/teamProperty → team → property → org → users
    await prisma.memberProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.teamMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.teamProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.team.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, adminEmail, memberEmail] } } });
    await app.close();
  });

  // ─── Grant: ADMIN ───────────────────────────────────────────────────────────

  it('ADMIN grants sA (within scope) to the MEMBER → 201 with MemberPropertyDto', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/members/${memberMemberId}/properties`)
      .set('Cookie', adminCookie)
      .send({ propertyId: sAId })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.memberId).toBe(memberMemberId);
    expect(res.body.data.propertyId).toBe(sAId);
    expect(typeof res.body.data.id).toBe('string');
  });

  it('Granting the same site again is idempotent → 201 same id', async () => {
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/members/${memberMemberId}/properties`)
      .set('Cookie', adminCookie)
      .send({ propertyId: sAId })
      .expect(201);
    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/members/${memberMemberId}/properties`)
      .set('Cookie', adminCookie)
      .send({ propertyId: sAId })
      .expect(201);
    expect(res1.body.data.id).toBe(res2.body.data.id);
  });

  it('ADMIN grants sB (beyond their scope) to the MEMBER → 403 PERM_002', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/members/${memberMemberId}/properties`)
      .set('Cookie', adminCookie)
      .send({ propertyId: sBId })
      .expect(403);

    expect(res.body.error.code).toBe('PERM_002');
  });

  it('ADMIN grants sA to an ADMIN-role target → 403 PERM_003', async () => {
    // adminMemberId is an ADMIN — ADMIN cannot manage another ADMIN
    const res = await request(app.getHttpServer())
      .post(`/api/v1/members/${adminMemberId}/properties`)
      .set('Cookie', adminCookie)
      .send({ propertyId: sAId })
      .expect(403);

    expect(res.body.error.code).toBe('PERM_003');
  });

  // ─── Grant: OWNER ────────────────────────────────────────────────────────────

  it('OWNER grants sB (any site) to the MEMBER → 201', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/members/${memberMemberId}/properties`)
      .set('Cookie', ownerCookie)
      .send({ propertyId: sBId })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.memberId).toBe(memberMemberId);
    expect(res.body.data.propertyId).toBe(sBId);
  });

  // ─── In-scope-slice view (GET /access) ───────────────────────────────────────

  it('ADMIN (scoped sA) viewing MEMBER access sees only sA, not sB', async () => {
    // At this point the MEMBER has both sA (direct grant from ADMIN) and sB (direct grant from OWNER)
    const res = await request(app.getHttpServer())
      .get(`/api/v1/members/${memberMemberId}/access`)
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('MEMBER');
    expect(res.body.data.unscoped).toBe(false);
    const ids: string[] = res.body.data.assignedRootPropertyIds;
    expect(ids).toContain(sAId);
    expect(ids).not.toContain(sBId);
  });

  it('OWNER viewing MEMBER access sees both sA and sB', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/members/${memberMemberId}/access`)
      .set('Cookie', ownerCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('MEMBER');
    expect(res.body.data.unscoped).toBe(false);
    const ids: string[] = res.body.data.assignedRootPropertyIds;
    expect(ids).toContain(sAId);
    expect(ids).toContain(sBId);
  });

  // ─── Audit ───────────────────────────────────────────────────────────────────

  it('ChangeLog CREATE row with entityType=MemberProperty exists after grant', async () => {
    const logs = await prisma.changeLog.findMany({
      where: { organizationId: orgId, entityType: 'MemberProperty', action: 'CREATE' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Revoke ──────────────────────────────────────────────────────────────────

  it('OWNER revokes sB from MEMBER → 204', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/members/${memberMemberId}/properties/${sBId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
  });

  it('Revoking a grant that does not exist is a no-op → 204', async () => {
    // sBId was just removed; removing again should still be 204
    await request(app.getHttpServer())
      .delete(`/api/v1/members/${memberMemberId}/properties/${sBId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
  });

  // ─── 404 / 401 guards ─────────────────────────────────────────────────────

  it('Grant to non-existent memberId → 404 ORG_001', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/members/00000000-0000-0000-0000-000000000000/properties`)
      .set('Cookie', ownerCookie)
      .send({ propertyId: sAId })
      .expect(404);

    expect(res.body.error.code).toBe('ORG_001');
  });

  it('Access view for non-existent memberId → 404 ORG_001', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/members/00000000-0000-0000-0000-000000000000/access`)
      .set('Cookie', ownerCookie)
      .expect(404);

    expect(res.body.error.code).toBe('ORG_001');
  });

  it('Returns 401 without auth', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/members/${memberMemberId}/properties`)
      .send({ propertyId: sAId })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/members/${memberMemberId}/properties/${sAId}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/members/${memberMemberId}/access`)
      .expect(401);
  });
});
