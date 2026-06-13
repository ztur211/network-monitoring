import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for join-request submit / list / approve / deny endpoints.
 * Requires running test database and Redis.
 */
describe('JoinRequests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminCookie: string;
  let adminUserId: string;
  let orgId: string;

  const testDomain = `jr-acme-${Date.now()}.test`;
  const adminEmail = `e2e-jr-admin-${Date.now()}@example.com`;
  const requesterEmail = `someone@${testDomain}`;
  const requester2Email = `other@${testDomain}`;
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

    // Sign up admin user
    adminCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminEmail, password, name: 'JR Admin' }),
    );
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    adminUserId = adminUser.id;

    // Create org with a verified domain
    const org = await prisma.organization.create({ data: { name: `E2E JoinRequests Org ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationDomain.create({
      data: { organizationId: orgId, domain: testDomain, verified: true },
    });
    await prisma.organizationMember.create({
      data: { userId: adminUserId, organizationId: orgId, role: 'OWNER' },
    });

    // Sign up requesters (not yet org members)
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: requesterEmail, password, name: 'Requester One' });
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: requester2Email, password, name: 'Requester Two' });
  });

  afterAll(async () => {
    // Clean up in safe deletion order
    await prisma.joinRequest.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationDomain.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, requesterEmail, requester2Email] } },
    });
    await app.close();
  });

  let joinRequestId: string;

  it('requester submits a join request → 201 and a PENDING JoinRequest row exists', async () => {
    const requesterCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: requesterEmail, password }),
    );

    const res = await request(app.getHttpServer())
      .post('/api/v1/join-requests')
      .set('Cookie', requesterCookie)
      .expect(201);

    expect(res.body.success).toBe(true);

    const requesterUser = await prisma.user.findUniqueOrThrow({ where: { email: requesterEmail } });
    const jr = await prisma.joinRequest.findFirst({ where: { userId: requesterUser.id, organizationId: orgId } });
    expect(jr).not.toBeNull();
    expect(jr?.status).toBe('PENDING');
    joinRequestId = jr!.id;
  });

  it('admin lists pending join requests → includes the requester\'s request', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/me/join-requests?status=PENDING')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = (res.body.data as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(joinRequestId);
  });

  it('admin approves the join request → 201 and requester now has MEMBER membership', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/me/join-requests/${joinRequestId}/approve`)
      .set('Cookie', adminCookie)
      .expect(201);

    const requesterUser = await prisma.user.findUniqueOrThrow({ where: { email: requesterEmail } });
    const member = await prisma.organizationMember.findUnique({ where: { userId: requesterUser.id } });
    expect(member).not.toBeNull();
    expect(member?.role).toBe('MEMBER');
    expect(member?.organizationId).toBe(orgId);
  });

  it('requester2 submits → admin denies → status DENIED and no membership; then requester2 re-submits → 201', async () => {
    // Requester2 submits
    const requester2Cookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: requester2Email, password }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/join-requests')
      .set('Cookie', requester2Cookie)
      .expect(201);

    const requester2User = await prisma.user.findUniqueOrThrow({ where: { email: requester2Email } });
    const jr2 = await prisma.joinRequest.findFirst({ where: { userId: requester2User.id, organizationId: orgId } });
    expect(jr2).not.toBeNull();

    // Admin denies
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/me/join-requests/${jr2!.id}/deny`)
      .set('Cookie', adminCookie)
      .expect(201);

    // Assert DENIED and no membership
    const deniedJr = await prisma.joinRequest.findUnique({ where: { id: jr2!.id } });
    expect(deniedJr?.status).toBe('DENIED');
    const noMember = await prisma.organizationMember.findFirst({ where: { userId: requester2User.id, organizationId: orgId } });
    expect(noMember).toBeNull();

    // Requester2 re-submits after denial → 201 (denial does not permanently block)
    await request(app.getHttpServer())
      .post('/api/v1/join-requests')
      .set('Cookie', requester2Cookie)
      .expect(201);
  });
});
