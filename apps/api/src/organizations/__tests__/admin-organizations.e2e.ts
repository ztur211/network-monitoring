import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * E2E tests for /api/v1/admin/organizations/* endpoints.
 * Requires running test database and Redis.
 */
describe('Admin organizations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  const adminEmail = `e2e-admin-${Date.now()}@example.com`;
  const password = 'Password123!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // Sign up, promote to super-admin, then sign in fresh to get a session that
    // reflects the isSuperAdmin flag (Better Auth cookieCache would serve stale
    // data from the sign-up session, so we sign in after the DB promotion).
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email: adminEmail, password, name: 'Admin' });

    await prisma.user.update({ where: { email: adminEmail }, data: { isSuperAdmin: true } });

    const signIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: adminEmail, password });
    const setCookie = signIn.headers['set-cookie'];
    adminCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  it('rejects a non-super-admin (no cookie) with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/organizations')
      .send({ name: 'Nope' })
      .expect(401);
  });

  it('super-admin creates an org and designates an owner', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/v1/admin/organizations')
      .set('Cookie', adminCookie)
      .send({ name: `E2E Org ${Date.now()}` })
      .expect(201);

    expect(create.body.success).toBe(true);
    const orgId: string = create.body.data.id;
    expect(orgId).toBeDefined();

    const owner = await prisma.user.create({
      data: { email: `owner-${Date.now()}@x.com`, emailVerified: true, name: 'Owner' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/admin/organizations/${orgId}/owner`)
      .set('Cookie', adminCookie)
      .send({ email: owner.email })
      .expect(201);

    const member = await prisma.organizationMember.findUnique({ where: { userId: owner.id } });
    expect(member?.role).toBe('OWNER');

    // Cleanup
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.organization.delete({ where: { id: orgId } });
  });
});
