import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Teams CRUD (e2e)', () => {
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

  const ts = Date.now();
  const ownerEmail = `e2e-teams-owner-${ts}@x.com`;
  const adminEmail = `e2e-teams-admin-${ts}@x.com`;
  const memberEmail = `e2e-teams-member-${ts}@x.com`;
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
    adminCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: adminEmail, password, name: 'Admin' }),
    );
    memberCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: memberEmail, password, name: 'Member' }),
    );

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });

    const org = await prisma.organization.create({ data: { name: `E2E Teams ${ts}` } });
    orgId = org.id;

    const ownerMember = await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    ownerMemberId = ownerMember.id;
    const adminMember = await prisma.organizationMember.create({ data: { userId: adminUser.id, organizationId: orgId, role: 'ADMIN' } });
    adminMemberId = adminMember.id;
    const memberMember = await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });
    memberMemberId = memberMember.id;

    // Site sA: the ADMIN is scoped to (via team assignment)
    const sA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `Site A ${ts}` } });
    sAId = sA.id;

    // Scope the ADMIN to sA so they can manage teams that include sA
    const scopeTeam = await prisma.team.create({ data: { organizationId: orgId, name: `Admin Scope ${ts}`, creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: scopeTeam.id, propertyId: sAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: scopeTeam.id, memberId: adminMemberId } });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, adminEmail, memberEmail] } } });
    await app.close();
  });

  // Track teams created during tests for cleanup ordering
  let adminCreatedTeamId: string;
  let ownerCreatedTeamId: string;

  it('ADMIN creates a team → 201; creatorMemberId equals admin\'s OrganizationMember.id', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .send({ name: `Admin Team ${ts}` })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(`Admin Team ${ts}`);
    expect(res.body.data.creatorMemberId).toBe(adminMemberId);
    expect(res.body.data.organizationId).toBe(orgId);
    adminCreatedTeamId = res.body.data.id;
  });

  it('MEMBER creates a team → 403 ORG_003', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Cookie', memberCookie)
      .send({ name: 'Member Team' })
      .expect(403);

    expect(res.body.error.code).toBe('ORG_003');
  });

  it('Duplicate name (case-insensitive) → 409 TEAM_002', async () => {
    // First creation (unique name for this case-insensitive test)
    const uniqueName = `Duplicate Test ${ts}`;
    await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .send({ name: uniqueName })
      .expect(201);

    // Exact duplicate
    const res1 = await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .send({ name: uniqueName })
      .expect(409);
    expect(res1.body.error.code).toBe('TEAM_002');

    // Case-insensitive duplicate
    const res2 = await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .send({ name: uniqueName.toUpperCase() })
      .expect(409);
    expect(res2.body.error.code).toBe('TEAM_002');
  });

  it('ADMIN renames a team they created → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/teams/${adminCreatedTeamId}`)
      .set('Cookie', adminCookie)
      .send({ baseVersion: 1, name: `Admin Team Renamed ${ts}` })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(`Admin Team Renamed ${ts}`);
    expect(res.body.data.version).toBe(2);
  });

  it('ADMIN renames a team created by OWNER → 403 PERM_003', async () => {
    // OWNER creates a team
    const ownerRes = await request(app.getHttpServer())
      .post('/api/v1/teams')
      .set('Cookie', ownerCookie)
      .send({ name: `Owner Team ${ts}` })
      .expect(201);
    ownerCreatedTeamId = ownerRes.body.data.id;

    // ADMIN (not the creator) tries to rename it
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/teams/${ownerCreatedTeamId}`)
      .set('Cookie', adminCookie)
      .send({ baseVersion: 1, name: 'Renamed By Admin' })
      .expect(403);

    expect(res.body.error.code).toBe('PERM_003');
  });

  it('OWNER renames any team → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/teams/${ownerCreatedTeamId}`)
      .set('Cookie', ownerCookie)
      .send({ baseVersion: 1, name: `Owner Team Renamed ${ts}` })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(`Owner Team Renamed ${ts}`);
  });

  it('OWNER deletes a team → 204', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/teams/${ownerCreatedTeamId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
  });

  it('ChangeLog CREATE row exists after team creation', async () => {
    const logs = await prisma.changeLog.findMany({
      where: { organizationId: orgId, entityType: 'Team', entityId: adminCreatedTeamId, action: 'CREATE' },
    });
    expect(logs.length).toBe(1);
  });

  it('GET /v1/teams lists teams visible to member (scoped)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/teams')
      .set('Cookie', memberCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    await request(app.getHttpServer()).get('/api/v1/teams').expect(401);
    await request(app.getHttpServer()).post('/api/v1/teams').send({ name: 'x' }).expect(401);
  });
});
