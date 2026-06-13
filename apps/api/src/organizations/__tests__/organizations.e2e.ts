import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Organizations self-service (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerCookie: string;
  let memberCookie: string;
  let orgId: string;
  const ownerEmail = `e2e-org-owner-${Date.now()}@x.com`;
  const memberEmail = `e2e-org-member-${Date.now()}@x.com`;
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

    ownerCookie = pickCookie(await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: ownerEmail, password, name: 'Owner' }));
    memberCookie = pickCookie(await request(app.getHttpServer()).post('/api/auth/sign-up/email').send({ email: memberEmail, password, name: 'Member' }));

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const org = await prisma.organization.create({ data: { name: `E2E SelfService ${Date.now()}` } });
    orgId = org.id;
    await prisma.organizationMember.create({ data: { userId: owner.id, organizationId: orgId, role: 'OWNER' } });
    await prisma.organizationMember.create({ data: { userId: member.id, organizationId: orgId, role: 'MEMBER' } });
  });

  afterAll(async () => {
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  it('member reads org and roster; MEMBER cannot patch; OWNER can', async () => {
    const me = await request(app.getHttpServer()).get('/api/v1/organizations/me').set('Cookie', memberCookie).expect(200);
    expect(me.body.data.id).toBe(orgId);

    const roster = await request(app.getHttpServer()).get('/api/v1/organizations/me/members').set('Cookie', memberCookie).expect(200);
    expect(roster.body.data).toHaveLength(2);

    const denied = await request(app.getHttpServer()).patch('/api/v1/organizations/me').set('Cookie', memberCookie)
      .send({ baseVersion: 1, changes: [{ field: 'namingPattern', oldValue: null, newValue: '^[a-z]+-[0-9]+$' }] }).expect(403);
    expect(denied.body.error.code).toBe('ORG_003');

    const ok = await request(app.getHttpServer()).patch('/api/v1/organizations/me').set('Cookie', ownerCookie)
      .send({ baseVersion: 1, changes: [{ field: 'namingPattern', oldValue: null, newValue: '^[a-z]+-[0-9]+$' }] }).expect(200);
    expect(ok.body.data.version).toBe(2);
    expect(ok.body.data.namingPattern).toBe('^[a-z]+-[0-9]+$');
  });
});
