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
  let _ownerMemberId: string;
  let adminMemberId: string;
  let _memberMemberId: string;
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
    _ownerMemberId = ownerMember.id;
    const adminMember = await prisma.organizationMember.create({ data: { userId: adminUser.id, organizationId: orgId, role: 'ADMIN' } });
    adminMemberId = adminMember.id;
    const memberMember = await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });
    _memberMemberId = memberMember.id;

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

describe('Team membership + site-assignment delegation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerCookie: string;
  let adminCookie: string;
  let admin2Cookie: string;
  let _memberCookie: string;

  let orgId: string;
  let ownerMemberId: string;
  let adminMemberId: string;
  let admin2MemberId: string;
  let memberMemberId: string;
  let member2MemberId: string;

  let sAId: string; // site A — within admin's scope
  let sBId: string; // site B — outside admin's scope (admin2's domain)

  // Teams created in the suite
  let adminTeamScopeId: string;   // scope team for admin (owns sA)
  let testTeamId: string;         // the working team used for membership tests (sA only)
  let crossTeamId: string;        // team spanning sA+sB — admin can't manage membership
  let ownerTeamId: string;        // team created by OWNER for structure tests

  const ts2 = Date.now() + 1; // distinct from outer suite
  const ownerEmail = `e2e-tmdel-owner-${ts2}@x.com`;
  const adminEmail = `e2e-tmdel-admin-${ts2}@x.com`;
  const admin2Email = `e2e-tmdel-admin2-${ts2}@x.com`;
  const memberEmail = `e2e-tmdel-member-${ts2}@x.com`;
  const member2Email = `e2e-tmdel-member2-${ts2}@x.com`;
  const password = 'Password123!';

  const pickCookie = (res: request.Response): string => {
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c[0] : (c as unknown as string);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // Sign up all five users
    ownerCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: ownerEmail, password, name: 'Owner' }),
    );
    adminCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: adminEmail, password, name: 'Admin' }),
    );
    admin2Cookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: admin2Email, password, name: 'Admin2' }),
    );
    _memberCookie = pickCookie(
      await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: memberEmail, password, name: 'Member' }),
    );
    await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: member2Email, password, name: 'Member2' });

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const admin2User = await prisma.user.findUniqueOrThrow({ where: { email: admin2Email } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const member2User = await prisma.user.findUniqueOrThrow({ where: { email: member2Email } });

    const org = await prisma.organization.create({ data: { name: `E2E TeamDel ${ts2}` } });
    orgId = org.id;

    const ownerMember = await prisma.organizationMember.create({ data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' } });
    ownerMemberId = ownerMember.id;
    const adminMember = await prisma.organizationMember.create({ data: { userId: adminUser.id, organizationId: orgId, role: 'ADMIN' } });
    adminMemberId = adminMember.id;
    const admin2Member = await prisma.organizationMember.create({ data: { userId: admin2User.id, organizationId: orgId, role: 'ADMIN' } });
    admin2MemberId = admin2Member.id;
    const memberMember = await prisma.organizationMember.create({ data: { userId: memberUser.id, organizationId: orgId, role: 'MEMBER' } });
    memberMemberId = memberMember.id;
    const member2Member = await prisma.organizationMember.create({ data: { userId: member2User.id, organizationId: orgId, role: 'MEMBER' } });
    member2MemberId = member2Member.id;

    // Two sites
    const sA = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `DelSite A ${ts2}` } });
    sAId = sA.id;
    const sB = await prisma.property.create({ data: { organizationId: orgId, parentId: null, type: 'SITE', name: `DelSite B ${ts2}` } });
    sBId = sB.id;

    // Scope admin1 → sA, admin2 → sB
    const adminScopeTeam = await prisma.team.create({ data: { organizationId: orgId, name: `Admin Scope Del ${ts2}`, creatorMemberId: null } });
    adminTeamScopeId = adminScopeTeam.id;
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: adminTeamScopeId, propertyId: sAId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: adminTeamScopeId, memberId: adminMemberId } });

    const admin2ScopeTeam = await prisma.team.create({ data: { organizationId: orgId, name: `Admin2 Scope Del ${ts2}`, creatorMemberId: null } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: admin2ScopeTeam.id, propertyId: sBId } });
    await prisma.teamMember.create({ data: { organizationId: orgId, teamId: admin2ScopeTeam.id, memberId: admin2MemberId } });

    // testTeam: created by admin1, scoped to sA only — admin1 can manage membership
    const testTeam = await prisma.team.create({ data: { organizationId: orgId, name: `Test Team Del ${ts2}`, creatorMemberId: adminMemberId } });
    testTeamId = testTeam.id;
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: testTeamId, propertyId: sAId } });

    // crossTeam: spans sA+sB — admin1 membership check fails (sB out of scope)
    const crossTeam = await prisma.team.create({ data: { organizationId: orgId, name: `Cross Team Del ${ts2}`, creatorMemberId: adminMemberId } });
    crossTeamId = crossTeam.id;
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: crossTeamId, propertyId: sAId } });
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: crossTeamId, propertyId: sBId } });

    // ownerTeam: for non-creator ADMIN structure tests
    const ownerTeam = await prisma.team.create({ data: { organizationId: orgId, name: `Owner Team Del ${ts2}`, creatorMemberId: ownerMemberId } });
    ownerTeamId = ownerTeam.id;
    await prisma.teamProperty.create({ data: { organizationId: orgId, teamId: ownerTeamId, propertyId: sAId } });
  });

  afterAll(async () => {
    // Delete in cascade-safe order: teamMember/teamProperty → team → memberProperty → property → org → users
    await prisma.teamMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.teamProperty.deleteMany({ where: { organizationId: orgId } });
    await prisma.team.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.property.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, adminEmail, admin2Email, memberEmail, member2Email] } } });
    await app.close();
  });

  // ─── Membership ───────────────────────────────────────────────────────────

  it('OWNER adds a MEMBER to a team → 201 with TeamMemberDto', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .set('Cookie', ownerCookie)
      .send({ memberId: memberMemberId })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.teamId).toBe(testTeamId);
    expect(res.body.data.memberId).toBe(memberMemberId);
    expect(typeof res.body.data.id).toBe('string');
  });

  it('Adding the same member again is idempotent → 201 same id', async () => {
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .set('Cookie', ownerCookie)
      .send({ memberId: memberMemberId })
      .expect(201);
    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .set('Cookie', ownerCookie)
      .send({ memberId: memberMemberId })
      .expect(201);
    expect(res1.body.data.id).toBe(res2.body.data.id);
  });

  it('ADMIN (scoped to sA) adds a MEMBER to their team (sA only) → 201', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .set('Cookie', adminCookie)
      .send({ memberId: member2MemberId })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.memberId).toBe(member2MemberId);
  });

  it('ADMIN adds a MEMBER to a team that spans sB (outside their scope) → 403 PERM_003', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${crossTeamId}/members`)
      .set('Cookie', adminCookie)
      .send({ memberId: member2MemberId })
      .expect(403);

    expect(res.body.error.code).toBe('PERM_003');
  });

  it('ADMIN adds an ADMIN-role target → 403 PERM_003', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .set('Cookie', adminCookie)
      .send({ memberId: admin2MemberId })
      .expect(403);

    expect(res.body.error.code).toBe('PERM_003');
  });

  it('ADMIN adds an OWNER-role target → 403 PERM_003', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .set('Cookie', adminCookie)
      .send({ memberId: ownerMemberId })
      .expect(403);

    expect(res.body.error.code).toBe('PERM_003');
  });

  it('Adding a non-existent memberId → 404 ORG_001', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .set('Cookie', ownerCookie)
      .send({ memberId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);

    expect(res.body.error.code).toBe('ORG_001');
  });

  it('OWNER removes a member → 204', async () => {
    // First add member2 to testTeam (idempotent if already there)
    await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .set('Cookie', ownerCookie)
      .send({ memberId: member2MemberId })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/teams/${testTeamId}/members/${member2MemberId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
  });

  it('Remove a member not on the team is a no-op → 204', async () => {
    // member2 was just removed above; removing again should still be 204
    await request(app.getHttpServer())
      .delete(`/api/v1/teams/${testTeamId}/members/${member2MemberId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
  });

  it('ChangeLog CREATE row exists after membership addition', async () => {
    // memberMemberId was added by OWNER in the first test
    const logs = await prisma.changeLog.findMany({
      where: { organizationId: orgId, entityType: 'TeamMember', action: 'CREATE' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Site-assignment ──────────────────────────────────────────────────────

  it('OWNER assigns any site to their team → 201 with TeamPropertyDto', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${ownerTeamId}/properties`)
      .set('Cookie', ownerCookie)
      .send({ propertyId: sBId })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.teamId).toBe(ownerTeamId);
    expect(res.body.data.propertyId).toBe(sBId);
    expect(typeof res.body.data.id).toBe('string');
  });

  it('Assigning the same site again is idempotent → 201 same id', async () => {
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/teams/${ownerTeamId}/properties`)
      .set('Cookie', ownerCookie)
      .send({ propertyId: sBId })
      .expect(201);
    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/teams/${ownerTeamId}/properties`)
      .set('Cookie', ownerCookie)
      .send({ propertyId: sBId })
      .expect(201);
    expect(res1.body.data.id).toBe(res2.body.data.id);
  });

  it('ADMIN (creator, sA scope) assigns sA-subtree site to their team → 201', async () => {
    // testTeam already has sA assigned; add a sub-site of sA
    const subSite = await prisma.property.create({
      data: { organizationId: orgId, parentId: sAId, type: 'FLOOR', name: `Floor 1 ${ts2}` },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/properties`)
      .set('Cookie', adminCookie)
      .send({ propertyId: subSite.id })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.propertyId).toBe(subSite.id);

    // Cleanup: remove the sub-site property assignment + property itself
    await prisma.teamProperty.deleteMany({ where: { propertyId: subSite.id } });
    await prisma.property.delete({ where: { id: subSite.id } });
  });

  it('ADMIN assigns sB (beyond their scope) to testTeam → 403 PERM_002', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/properties`)
      .set('Cookie', adminCookie)
      .send({ propertyId: sBId })
      .expect(403);

    expect(res.body.error.code).toBe('PERM_002');
  });

  it('Non-creator ADMIN (admin2) tries to assign site to admin1\'s testTeam → 403 PERM_003', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/properties`)
      .set('Cookie', admin2Cookie)
      .send({ propertyId: sBId })
      .expect(403);

    expect(res.body.error.code).toBe('PERM_003');
  });

  it('OWNER unassigns a site from a team → 204', async () => {
    // ownerTeam now has sA (from beforeAll) + sB (assigned above) — unassign sB
    await request(app.getHttpServer())
      .delete(`/api/v1/teams/${ownerTeamId}/properties/${sBId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
  });

  it('Unassigning a site not on the team is a no-op → 204', async () => {
    // sBId was just removed from ownerTeam — removing again should be 204
    await request(app.getHttpServer())
      .delete(`/api/v1/teams/${ownerTeamId}/properties/${sBId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
  });

  it('ChangeLog CREATE row exists after site assignment', async () => {
    const logs = await prisma.changeLog.findMany({
      where: { organizationId: orgId, entityType: 'TeamProperty', action: 'CREATE' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 401 without auth on member endpoints', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/members`)
      .send({ memberId: memberMemberId })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/teams/${testTeamId}/members/${memberMemberId}`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/teams/${testTeamId}/properties`)
      .send({ propertyId: sAId })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/v1/teams/${testTeamId}/properties/${sAId}`)
      .expect(401);
  });
});
