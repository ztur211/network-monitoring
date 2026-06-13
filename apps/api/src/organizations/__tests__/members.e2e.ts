import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for member role-change and removal endpoints.
 * Requires running test database and Redis.
 */
describe('Members (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let orgId: string;

  let ownerCookie: string;
  let ownerUserId: string;

  let adminCookie: string;
  let adminUserId: string;

  let memberUserId: string;

  const ownerEmail = `e2e-members-owner-${Date.now()}@example.com`;
  const adminEmail = `e2e-members-admin-${Date.now()}@example.com`;
  const memberEmail = `e2e-members-member-${Date.now()}@example.com`;
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

    // Sign up all three users
    ownerCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: ownerEmail, password, name: 'Owner' }),
    );
    adminCookie = pickCookie(
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email: adminEmail, password, name: 'Admin' }),
    );
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: memberEmail, password, name: 'Member' });

    ownerUserId = (await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id;
    adminUserId = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    memberUserId = (await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } })).id;

    // Create the org and add all three members
    const org = await prisma.organization.create({ data: { name: `E2E Members Org ${Date.now()}` } });
    orgId = org.id;

    await prisma.organizationMember.createMany({
      data: [
        { userId: ownerUserId, organizationId: orgId, role: 'OWNER' },
        { userId: adminUserId, organizationId: orgId, role: 'ADMIN' },
        { userId: memberUserId, organizationId: orgId, role: 'MEMBER' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, adminEmail, memberEmail] } },
    });
    await app.close();
  });

  it('OWNER promotes a MEMBER to ADMIN → 200 and DB role is ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/organizations/me/members/${memberUserId}`)
      .set('Cookie', ownerCookie)
      .send({ role: 'ADMIN' })
      .expect(200);

    expect(res.body.success).toBe(true);

    const member = await prisma.organizationMember.findFirst({
      where: { userId: memberUserId, organizationId: orgId },
    });
    expect(member?.role).toBe('ADMIN');

    // Restore MEMBER role for subsequent tests
    await prisma.organizationMember.updateMany({
      where: { userId: memberUserId, organizationId: orgId },
      data: { role: 'MEMBER' },
    });
  });

  it('ADMIN trying to remove the OWNER → 403 ORG_003', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/organizations/me/members/${ownerUserId}`)
      .set('Cookie', adminCookie)
      .expect(403);

    expect(res.body.error.code).toBe('ORG_003');
  });

  it('OWNER removing themselves (sole OWNER) → 409 ORG_013', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/organizations/me/members/${ownerUserId}`)
      .set('Cookie', ownerCookie)
      .expect(409);

    expect(res.body.error.code).toBe('ORG_013');
  });

  it('OWNER removes the MEMBER → 200 and membership row is gone', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/organizations/me/members/${memberUserId}`)
      .set('Cookie', ownerCookie)
      .expect(200);

    expect(res.body.success).toBe(true);

    const gone = await prisma.organizationMember.findFirst({
      where: { userId: memberUserId, organizationId: orgId },
    });
    expect(gone).toBeNull();
  });

  it('targeting a non-existent member → 404 ORG_002', async () => {
    const nonExistentUserId = '00000000-0000-0000-0000-000000000099';
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/organizations/me/members/${nonExistentUserId}`)
      .set('Cookie', ownerCookie)
      .send({ role: 'MEMBER' })
      .expect(404);

    expect(res.body.error.code).toBe('ORG_002');
  });
});
