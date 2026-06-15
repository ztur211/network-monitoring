import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for invitation create / list / revoke / accept endpoints.
 * Requires running test database and Redis.
 */
describe('Invitations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminCookie: string;
  let adminUserId: string;
  let ownerCookie: string;
  let orgId: string;

  const ts = Date.now();
  const adminEmail = `e2e-inv-admin-${ts}@example.com`;
  const ownerEmail = `e2e-inv-owner-${ts}@example.com`;
  const inviteeEmail = `e2e-inv-invitee-${ts}@example.com`;
  const otherEmail = `e2e-inv-other-${ts}@example.com`;
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

    // Sign up owner user
    ownerCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password, name: 'Owner' }),
    );
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });

    // Sign up admin user (ADMIN role — may only invite MEMBERs)
    adminCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminEmail, password, name: 'Admin' }),
    );
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    adminUserId = adminUser.id;

    // Create org; wire owner as OWNER, admin as ADMIN
    const org = await prisma.organization.create({ data: { name: `E2E Invitations Org ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({
      data: { userId: ownerUser.id, organizationId: orgId, role: 'OWNER' },
    });
    await prisma.organizationMember.create({
      data: { userId: adminUserId, organizationId: orgId, role: 'ADMIN' },
    });

    // Sign up invitee and other user (they are NOT yet org members)
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: inviteeEmail, password, name: 'Invitee' });
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: otherEmail, password, name: 'Other' });
  });

  afterAll(async () => {
    // Clean up in safe deletion order
    await prisma.invitation.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, adminEmail, inviteeEmail, otherEmail] } },
    });
    await app.close();
  });

  let inviteToken: string;

  it('admin creates an invitation → 201 with data.token and data.url', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/organizations/me/invitations')
      .set('Cookie', adminCookie)
      .send({ email: inviteeEmail, role: 'MEMBER' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.url).toContain('/invite/');
    expect(res.body.data.invitation.email).toBe(inviteeEmail.toLowerCase());
    inviteToken = res.body.data.token as string;
  });

  it('admin can list pending invitations', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/me/invitations')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('a different user (wrong email) accepting the token → 403 ORG_010', async () => {
    // Sign in as "other" user
    const otherCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: otherEmail, password }),
    );

    const res = await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Cookie', otherCookie)
      .send({ token: inviteToken })
      .expect(403);

    expect(res.body.error.code).toBe('ORG_010');
  });

  it('invitee accepts token → 201 and becomes a MEMBER', async () => {
    // Sign in as invitee
    const inviteeCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: inviteeEmail, password }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Cookie', inviteeCookie)
      .send({ token: inviteToken })
      .expect(201);

    const inviteeUser = await prisma.user.findUniqueOrThrow({ where: { email: inviteeEmail } });
    const member = await prisma.organizationMember.findUnique({ where: { userId: inviteeUser.id } });
    expect(member).not.toBeNull();
    expect(member?.role).toBe('MEMBER');
  });

  it('invitee cannot accept the same token again (already accepted) → 404 ORG_009', async () => {
    const inviteeCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: inviteeEmail, password }),
    );

    const res = await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Cookie', inviteeCookie)
      .send({ token: inviteToken })
      .expect(404);

    expect(res.body.error.code).toBe('ORG_009');
  });

  it('admin can revoke a pending invitation → 200', async () => {
    // Create a new invitation to revoke
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/organizations/me/invitations')
      .set('Cookie', adminCookie)
      .send({ email: `revoke-${Date.now()}@example.com`, role: 'MEMBER' })
      .expect(201);

    const invitationId: string = createRes.body.data.invitation.id;

    await request(app.getHttpServer())
      .delete(`/api/v1/organizations/me/invitations/${invitationId}`)
      .set('Cookie', adminCookie)
      .expect(200);
  });

  it('revoking a non-existent invitation → 404 ORG_009', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/organizations/me/invitations/${fakeId}`)
      .set('Cookie', adminCookie)
      .expect(404);

    expect(res.body.error.code).toBe('ORG_009');
  });

  it('ADMIN may invite MEMBER but not ADMIN or OWNER; OWNER may invite any role', async () => {
    // ADMIN invites MEMBER → 201
    await request(app.getHttpServer())
      .post('/api/v1/organizations/me/invitations')
      .set('Cookie', adminCookie)
      .send({ email: `new-member-${Date.now()}@x.io`, role: 'MEMBER' })
      .expect(201);

    // ADMIN invites ADMIN → 403 PERM_003
    const deniedAdmin = await request(app.getHttpServer())
      .post('/api/v1/organizations/me/invitations')
      .set('Cookie', adminCookie)
      .send({ email: `boss-${Date.now()}@x.io`, role: 'ADMIN' })
      .expect(403);
    expect(deniedAdmin.body.error.code).toBe('PERM_003');

    // ADMIN invites OWNER → 403 PERM_003
    const deniedOwner = await request(app.getHttpServer())
      .post('/api/v1/organizations/me/invitations')
      .set('Cookie', adminCookie)
      .send({ email: `owner2-${Date.now()}@x.io`, role: 'OWNER' })
      .expect(403);
    expect(deniedOwner.body.error.code).toBe('PERM_003');

    // OWNER invites ADMIN → 201
    await request(app.getHttpServer())
      .post('/api/v1/organizations/me/invitations')
      .set('Cookie', ownerCookie)
      .send({ email: `admin2-${Date.now()}@x.io`, role: 'ADMIN' })
      .expect(201);
  });
});
